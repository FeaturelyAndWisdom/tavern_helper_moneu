import { createScriptIdDiv, teleportStyle } from '@util/script';
import Window from './Window.vue';
import './style.scss';
import { useBluetooth, type DeviceInfo } from './useBluetooth';
import { useWaveform, type CommandPoint } from './useWaveform';

const { waveformData, waveformCurrentTime, waveformActive, lastCommandRaw, registerStopExecution } = useWaveform();

// 解析后的结构体定义
interface FuncUnit {
  funcCode: string;
  strength: number;
}

interface CommandElement {
  time: number;
  funcUnits: FuncUnit[];
}

interface ParsedCommandSet {
  globalTime: number;
  totalDuration: number;
  commands: CommandElement[];
}

interface QueueItem {
  time: number;
  funcCode: string;
  strength: number;
}

// 设备控制 Prompt 模板
function buildDevicePrompt(deviceInfo: DeviceInfo, scenario: string): string {
  const functions = deviceInfo.runtimeConf?.functions ?? [];
  const functionInfoList = functions.map(
    f =>
      `{"功能单元code":"${f.funcCode}","功能单元描述":"${f.funcDesc}","最大强度":${f.maxStrength},"最小强度":${f.minStrength}}`,
  );
  const functionInfoStr = functionInfoList.join('\n');
  const user = substitudeMacros("{{user}}");

  return `
不影响情节与设定，对于消息回复进行增强。
当前已连接情趣用品设备，设备作用于${user}，根据指令场景，生成设备指令进行返回

# 设备信息
${functionInfoStr}

# 指令组成
全局时间：指令集在全局时间循环执行，单位ms
指令集：指令元素集合
指令元素：包含指令执行时间（单位ms）及功能单元集合
功能单元：功能单元code和功能单元强度

# 指令场景
${scenario}

# 数据格式
1.数据包裹在<!--<muCmd></muCmd>-->标签中
2.数据皆以数组形式展示
3.功能单元强度为0表示暂停该功能单元。功能单元间互相隔离。
4.指令执行时间必须大于0。
5.全局时间可以为0，表示持续循环，当没有明确指定时间是，默认持续循环。
6.下标0为"全局时间",1为"指令集"数组，"指令集"数组每个元素为"指令元素"，"指令元素"下标0为指令元素执行时间，1为功能单元集合，每个功能单元元素，下标0为功能单元code，下标1为强度，参考【指令示例】

# 指令示例
<!--
<muCmd>[1000,[[100,["01",100]],[200,["01",50]]]]</muCmd>
-->
`;
}

// muCmd 解析器
class MuCmdParser {
  private buffer = '';
  private isCapturing = false;
  private lastFullTextLength = 0;
  private sendFuncStrength: (funcCode: string, strength: number) => Promise<boolean>;
  private timeTracker: ReturnType<typeof setInterval> | null = null;
  private loopStartTime = 0;
  private currentCycleTime = 0;
  private executionGeneration = 0;
  private activeFuncCodes = new Set<string>();

  constructor(sendFuncStrength: (funcCode: string, strength: number) => Promise<boolean>) {
    this.sendFuncStrength = sendFuncStrength;
  }

  processIncrement(fullText: string): void {
    if (fullText.length <= this.lastFullTextLength) return;

    const delta = fullText.substring(this.lastFullTextLength);
    this.lastFullTextLength = fullText.length;
    this.buffer += delta;

    while (true) {
      if (!this.isCapturing) {
        const startTag = '<muCmd>';
        const startIdx = this.buffer.indexOf(startTag);
        if (startIdx === -1) {
          const keepFrom = this.buffer.lastIndexOf('<');
          if (keepFrom > 0) {
            this.buffer = this.buffer.substring(keepFrom);
          } else if (this.buffer.length > 200) {
            this.buffer = '';
          }
          break;
        }
        this.isCapturing = true;
        this.buffer = this.buffer.substring(startIdx + startTag.length);
      }

      if (this.isCapturing) {
        const endTag = '</muCmd>';
        const endIdx = this.buffer.indexOf(endTag);
        if (endIdx === -1) break;

        const cmdData = this.buffer.substring(0, endIdx);
        this.buffer = this.buffer.substring(endIdx + endTag.length);
        this.isCapturing = false;

        console.log('[MuCmd] 捕获到完整指令:', cmdData.trim());
        this.executeCommand(cmdData.trim());
      }
    }
  }

  /**
   * 解析功能单元，兼容两种格式:
   * 格式A (多个功能单元作为独立元素): [time, ["01", 80], ["02", 50]]
   * 格式B (功能单元集合在 index 1):  [time, [["01", 80], ["02", 50]]]
   * 单功能单元简写:                   [time, ["01", 80]]
   */
  private parseFuncUnits(element: unknown[]): FuncUnit[] {
    const funcUnits: FuncUnit[] = [];
    const rest = element.slice(1);

    for (const item of rest) {
      if (!Array.isArray(item)) continue;

      if (typeof item[0] === 'string') {
        funcUnits.push({ funcCode: item[0] as string, strength: item[1] as number });
      } else if (Array.isArray(item[0])) {
        for (const pair of item) {
          if (Array.isArray(pair) && typeof pair[0] === 'string') {
            funcUnits.push({ funcCode: pair[0] as string, strength: pair[1] as number });
          }
        }
      }
    }

    return funcUnits;
  }

  private parseCommandSet(parsed: unknown[]): ParsedCommandSet {
    const globalTime = parsed[0] as number;
    const rawCommands = parsed[1] as unknown[][];

    let cumulativeTime = 0;
    const commands: CommandElement[] = rawCommands.map(element => {
      const duration = element[0] as number;
      const cmd: CommandElement = {
        time: cumulativeTime,
        funcUnits: this.parseFuncUnits(element),
      };
      cumulativeTime += duration;
      return cmd;
    });

    return { globalTime, totalDuration: cumulativeTime, commands };
  }

  private buildQueue(commandSet: ParsedCommandSet): QueueItem[] {
    const queue: QueueItem[] = [];

    for (const cmd of commandSet.commands) {
      for (const fu of cmd.funcUnits) {
        queue.push({ time: cmd.time, funcCode: fu.funcCode, strength: fu.strength });
      }
    }

    queue.sort((a, b) => a.time - b.time);
    return queue;
  }

  private executeCommand(cmdData: string): void {
    try {
      const parsed = JSON.parse(cmdData);

      if (!Array.isArray(parsed) || parsed.length < 2) {
        console.error('[MuCmd] 指令格式错误: 期望 [全局时间, 指令集]');
        return;
      }

      if (!Array.isArray(parsed[1]) || parsed[1].length === 0) {
        console.error('[MuCmd] 指令集为空');
        return;
      }

      lastCommandRaw.value = cmdData;

      const commandSet = this.parseCommandSet(parsed);
      const cycleTime = commandSet.totalDuration > 0 ? commandSet.totalDuration : 1;

      console.log('[MuCmd] 解析后的指令结构:');
      console.log(`  全局时间: ${commandSet.globalTime}ms, 循环周期: ${cycleTime}ms`);
      for (const cmd of commandSet.commands) {
        const unitDesc = cmd.funcUnits.map(u => `功能单元=${u.funcCode} 强度=${u.strength}`).join(', ');
        console.log(`  [${cmd.time}ms] ${unitDesc}`);
      }

      const queue = this.buildQueue(commandSet);
      console.log('[MuCmd] 执行队列:');
      console.table(queue);

      const waveformPoints: CommandPoint[] = commandSet.commands.flatMap(cmd =>
        cmd.funcUnits.map(fu => ({ funcCode: fu.funcCode, time: cmd.time, strength: fu.strength })),
      );
      waveformData.value = { globalTime: cycleTime, commands: waveformPoints };
      this.currentCycleTime = cycleTime;

      this.startExecution(queue, cycleTime, commandSet.globalTime);
    } catch (error) {
      console.error('[MuCmd] 解析指令失败:', error);
    }
  }

  private startTimeTracker(): void {
    this.stopTimeTracker();
    this.loopStartTime = Date.now();

    this.timeTracker = setInterval(() => {
      const elapsed = Date.now() - this.loopStartTime;
      waveformCurrentTime.value = elapsed % this.currentCycleTime;
    }, 50);
  }

  private stopTimeTracker(): void {
    if (this.timeTracker) {
      clearInterval(this.timeTracker);
      this.timeTracker = null;
    }
  }

  private startExecution(queue: QueueItem[], cycleTime: number, globalTime: number): void {
    this.stopExecution();
    waveformActive.value = true;
    this.startTimeTracker();

    const gen = ++this.executionGeneration;
    const isStale = () => gen !== this.executionGeneration;

    const funcCodes = [...new Set(queue.map(item => item.funcCode))];
    funcCodes.forEach(code => this.activeFuncCodes.add(code));
    const startedAt = Date.now();

    const cappedWait = (ms: number): Promise<void> => {
      if (globalTime > 0) {
        const remaining = globalTime - (Date.now() - startedAt);
        if (remaining <= 0) return Promise.resolve();
        return new Promise(r => setTimeout(r, Math.min(ms, remaining)));
      }
      return new Promise(r => setTimeout(r, ms));
    };

    const isExpired = (): boolean => globalTime > 0 && Date.now() - startedAt >= globalTime;

    const executeSequence = async () => {
      let currentTime = 0;
      this.loopStartTime = Date.now();

      for (const item of queue) {
        if (isStale() || isExpired()) return;

        if (item.time > currentTime) {
          await cappedWait(item.time - currentTime);
          currentTime = item.time;
        }
        if (isStale() || isExpired()) return;

        try {
          await this.sendFuncStrength(item.funcCode, item.strength);
        } catch (error) {
          console.error('[MuCmd] 指令执行失败:', error);
        }
      }

      if (isStale() || isExpired()) return;

      const remaining = cycleTime - currentTime;
      if (remaining > 0) {
        await cappedWait(remaining);
      }
    };

    const run = async () => {
      console.log(`[MuCmd] 循环执行，周期: ${cycleTime}ms, 全局时间: ${globalTime > 0 ? globalTime + 'ms' : '无限'}`);
      while (!isStale() && !isExpired()) {
        await executeSequence();
      }

      if (isStale()) return;

      console.log('[MuCmd] 执行结束，发送暂停指令');
      for (const funcCode of funcCodes) {
        try {
          await this.sendFuncStrength(funcCode, 0);
        } catch (error) {
          console.error(`[MuCmd] 暂停功能单元 ${funcCode} 失败:`, error);
        }
      }

      this.stopTimeTracker();
      waveformActive.value = false;
    };

    run();
  }

  stopExecution(): void {
    this.executionGeneration++;
    this.stopTimeTracker();
    // waveformData is preserved so the chart keeps displaying old data and replay remains functional
    waveformActive.value = false;
  }

  reset(): void {
    this.buffer = '';
    this.isCapturing = false;
    this.lastFullTextLength = 0;
    this.stopExecution();

    const codes = [...this.activeFuncCodes];
    this.activeFuncCodes.clear();
    for (const funcCode of codes) {
      this.sendFuncStrength(funcCode, 0).catch(err =>
        console.error(`[MuCmd] reset 暂停功能单元 ${funcCode} 失败:`, err),
      );
    }
  }
}

let promptInjection: { uninject: () => void } | null = null;
let streamListener: { stop: () => void } | null = null;
let generationStartListener: { stop: () => void } | null = null;
let muCmdParser: MuCmdParser | null = null;

$(() => {
  const app = createApp(Window).use(createPinia());

  const $window = createScriptIdDiv().appendTo('body');
  app.mount($window[0]);

  const { destroy } = teleportStyle();

  // 获取蓝牙 hook
  const { isConnected, deviceInfo, deviceScenario, sendFunctionStrength } = useBluetooth();

  const updateInjection = () => {
    // 清理之前的注入
    if (promptInjection) {
      promptInjection.uninject();
      promptInjection = null;
    }

    if (isConnected.value && deviceInfo.value) {
      const prompt = buildDevicePrompt(deviceInfo.value, deviceScenario.value);
      console.log('[Bluetooth] 注入设备控制 Prompt');
      promptInjection = injectPrompts([
        {
          id: 'bluetooth-device-control',
          role: 'system',
          content: prompt,
          position: 'in_chat',
          depth: 1,
          should_scan: true,
        },
      ]);
    }
  };

  // 监听连接状态变化，注入/取消注入 prompt
  watch(
    [isConnected, deviceInfo, deviceScenario],
    ([connected, info, scenario]) => {
      updateInjection();

      if (streamListener) {
        streamListener.stop();
        streamListener = null;
      }
      if (generationStartListener) {
        generationStartListener.stop();
        generationStartListener = null;
      }
      if (muCmdParser) {
        muCmdParser.reset();
        muCmdParser = null;
      }
      registerStopExecution(() => {});
      if (connected && info) {
        muCmdParser = new MuCmdParser(sendFunctionStrength);
        registerStopExecution(async () => {
          if (muCmdParser) {
            muCmdParser.stopExecution();
          }
          const funcs = info.runtimeConf?.functions ?? [];
          for (const f of funcs) {
            try { await sendFunctionStrength(f.funcCode, 0); } catch { /* noop */ }
          }
        });

        generationStartListener = eventOn(tavern_events.GENERATION_STARTED, (_type, _option, dry_run) => {
          if (dry_run) return;
          if (muCmdParser) {
            muCmdParser.reset();
          }  
        });

        streamListener = eventOn(tavern_events.STREAM_TOKEN_RECEIVED, (text: string) => {
          if (muCmdParser) {
            muCmdParser.processIncrement(text);
          }
        });

        console.log('[Bluetooth] 流式监听已启动 (tavern_events.STREAM_TOKEN_RECEIVED)');
      }
    },
    { immediate: true },
  );

  // 跨聊天文件或在新开聊天时重新注入提示词
  eventOn(tavern_events.CHAT_CHANGED, () => {
    updateInjection();
  });

  // 使用 jquery-ui 实现拖拽
  $window.find('.floating-window').draggable({
    handle: '.floating-window__header',
    containment: 'window',
  });

  // 添加脚本按钮控制窗口显示/隐藏
  appendInexistentScriptButtons([{ name: '蓝牙控制', visible: true }]);

  eventOn(getButtonEvent('蓝牙控制'), () => {
    $window.toggle();
  });

  $(window).on('pagehide', () => {
    if (promptInjection) {
      promptInjection.uninject();
    }
    if (streamListener) {
      streamListener.stop();
    }
    if (generationStartListener) {
      generationStartListener.stop();
    }
    if (muCmdParser) {
      muCmdParser.reset();
    }
    app.unmount();
    $window.remove();
    destroy();
  });
});
