import { createScriptIdDiv, teleportStyle } from '@util/script';
import Window from './Window.vue';
import './style.scss';
import { useBluetooth, type DeviceInfo } from './useBluetooth';
interface QueueItem {
  time: number;
  deviceNo: string;
  funcCode: string;
  strength: number;
}

interface StrengthStep {
  strength: number;
  /** 该强度持续的秒数 */
  holdTime: number;
}

function buildDevicePrompt(deviceInfos: DeviceInfo[], _scenario: string): string {
  const deviceBlocks = deviceInfos.map(info => {
    const functions = info.runtimeConf?.functions ?? [];
    const funcLines = functions.map(
      f => `  - 功能点code: ${f.funcCode}, 描述: ${f.funcDesc}, 强度范围: ${f.minStrength}~${f.maxStrength}`,
    );
    return `设备编号: ${info.deviceNo}\n设备名称: ${info.deviceName}\n设备描述: ${info.runtimeConf?.deviceDesc ?? ''}\n功能点:\n${funcLines.join('\n')}`;
  });
  const functionInfoStr = deviceBlocks.join('\n\n');

  return `[系统指令：启用 MONEU 情趣玩具反馈协议]
你现在连接到了用户的情趣玩具。根据剧情中发生的情节与角色行为，在回复中插入控制标签来给用户真实的体感反馈。

[设备信息]
${functionInfoStr}

[指令格式]
[MU:设备编号:功能点:强度参数:持续时间(可选,秒)]

强度参数有两种写法：
A) 单一强度：一个数字，如 20。适用于瞬间动作、简短触碰、一次性打击。
B) 多强度循环：2~5个"强度(秒)"用"-"连接，循环播放。适用于持续的、有节奏的、波浪式的动作，如抚摸、按摩、节奏性鞭打、持续刺激、渐强渐弱等。

持续时间：可选，单位秒，支持小数。省略则持续执行（单一强度）或无限循环（多强度）。

[场景选择指南]
根据剧情动作性质选择合适的指令类型：
- 短暂触碰/点触/轻拍 → 单一强度，短持续时间：[MU:09:01:15:1]
- 一次打击/捏/掐 → 单一强度：[MU:09:01:30:2]
- 持续抚摸/按摩 → 多强度循环，模拟力度变化：[MU:09:01:10(1.5)-25(1.5)]
- 有节奏的鞭打/拍打 → 多强度循环，交替击打与间歇：[MU:09:01:35(0.5)-5(0.8):6]
- 渐强刺激/逐步加力 → 多强度循环，阶梯式递增：[MU:09:01:10(1)-20(1)-35(1)-50(1):8]
- 波浪式快感 → 多强度循环，起伏模式：[MU:09:01:15(1.2)-40(0.8)-20(1)-50(0.6)]
- 惩罚性持续强刺激 → 单一高强度：[MU:09:01:55:10]

[规则]
- 标签仅在正文中输出，不得在思维链等其他部分输出完整标签。
- 多强度循环最多5个强度段。
- 根据动作的性质自然选择单一强度或多强度循环，持续性/节奏性/渐变性的动作应优先使用多强度循环。`;
}

/**
 * 解析 [MU:deviceNo:funcCode:strengthParam:duration?] 标签
 *
 * 单一强度:
 *   [MU:09:01:15]      → 持续执行强度 15
 *   [MU:09:01:15:4]    → 强度 15 执行 4 秒后归零
 *
 * 多强度循环:
 *   [MU:09:01:15(1.5)-58(1.3)]    → 15 强度 1.5s → 58 强度 1.3s，无限循环
 *   [MU:09:01:20(2)-30(1.4):4]    → 20 强度 2s → 30 强度 1.4s，循环 4 秒后归零
 */
interface MuTag {
  deviceNo: string;
  funcCode: string;
  /** 单一强度值（仅在 steps 为空时使用） */
  strength: number;
  /** 多强度循环步骤 */
  steps: StrengthStep[];
  /** 总持续时间（秒），null 表示持续执行/无限循环 */
  duration: number | null;
}

class MuCmdParser {
  private buffer = '';
  private lastFullTextLength = 0;
  private sendFuncStrength: (deviceNo: string, funcCode: string, strength: number) => Promise<boolean>;
  private executionGeneration = 0;
  private activeKeys = new Set<string>();

  constructor(sendFuncStrength: (deviceNo: string, funcCode: string, strength: number) => Promise<boolean>) {
    this.sendFuncStrength = sendFuncStrength;
  }

  processIncrement(fullText: string): void {
    if (fullText.length <= this.lastFullTextLength) return;

    const delta = fullText.substring(this.lastFullTextLength);
    this.lastFullTextLength = fullText.length;
    this.buffer += delta;

    const tags = this.extractTags();
    if (tags.length > 0) {
      this.executeTags(tags);
    }
  }

  /**
   * 解析强度参数字段，支持:
   * - "15"              → 单一强度
   * - "15(1.5)-58(1.3)" → 多强度循环步骤
   */
  private static parseStrengthParam(raw: string): { strength: number; steps: StrengthStep[] } | null {
    const multiPattern = /^(\d+)\((\d+(?:\.\d+)?)\)(?:-(\d+)\((\d+(?:\.\d+)?)\))+$/;
    if (multiPattern.test(raw)) {
      const stepPattern = /(\d+)\((\d+(?:\.\d+)?)\)/g;
      const steps: StrengthStep[] = [];
      let m: RegExpExecArray | null;
      while ((m = stepPattern.exec(raw)) !== null) {
        steps.push({ strength: parseInt(m[1], 10), holdTime: parseFloat(m[2]) });
      }
      const MAX_STEPS = 5;
      if (steps.length >= 2 && steps.every(s => !isNaN(s.strength) && !isNaN(s.holdTime) && s.holdTime > 0)) {
        if (steps.length > MAX_STEPS) {
          console.warn(`[MuCmd] 多强度步数超限(${steps.length}>${MAX_STEPS})，截断为前${MAX_STEPS}步`);
          steps.length = MAX_STEPS;
        }
        return { strength: steps[0].strength, steps };
      }
      return null;
    }

    const strength = parseInt(raw, 10);
    if (isNaN(strength)) return null;
    return { strength, steps: [] };
  }

  /** 从 buffer 中提取所有完整的 [MU:...] 标签 */
  private extractTags(): MuTag[] {
    const tags: MuTag[] = [];
    const regex = /\[MU:([^\]]+)\]/g;
    let match: RegExpExecArray | null;

    let lastEnd = 0;
    while ((match = regex.exec(this.buffer)) !== null) {
      const parts = match[1].split(':');
      if (parts.length < 3) {
        console.warn(`[MuCmd] 标签参数不足: ${match[0]}`);
        continue;
      }

      const deviceNo = parts[0];
      const funcCode = parts[1];
      const parsed = MuCmdParser.parseStrengthParam(parts[2]);
      if (!parsed) {
        console.warn(`[MuCmd] 无效强度参数: ${match[0]}`);
        continue;
      }

      const duration = parts.length >= 4 ? parseFloat(parts[3]) : null;
      if (duration !== null && (isNaN(duration) || duration <= 0)) {
        console.warn(`[MuCmd] 无效持续时间: ${match[0]}`);
        continue;
      }

      tags.push({ deviceNo, funcCode, strength: parsed.strength, steps: parsed.steps, duration });
      lastEnd = match.index + match[0].length;
    }

    if (lastEnd > 0) {
      this.buffer = this.buffer.substring(lastEnd);
    } else if (this.buffer.length > 500) {
      const keepFrom = this.buffer.lastIndexOf('[');
      this.buffer = keepFrom > 0 ? this.buffer.substring(keepFrom) : '';
    }

    return tags;
  }

  /** 执行多强度循环：在 totalDurationMs 内（null 则无限）循环播放 steps */
  private async runCycleLoop(
    tag: MuTag,
    isStale: () => boolean,
  ): Promise<void> {
    const { steps, duration, deviceNo, funcCode } = tag;
    const totalMs = duration !== null ? duration * 1000 : Infinity;
    const startTime = performance.now();

    while (!isStale()) {
      for (const step of steps) {
        if (isStale()) return;
        const elapsed = performance.now() - startTime;
        if (elapsed >= totalMs) {
          await this.sendFuncStrength(deviceNo, funcCode, 0).catch(() => {});
          return;
        }
        const holdMs = step.holdTime * 1000;
        const remaining = totalMs - elapsed;
        const actualHold = Math.min(holdMs, remaining);

        try {
          await this.sendFuncStrength(deviceNo, funcCode, step.strength);
        } catch (error) {
          console.error('[MuCmd] 循环指令发送失败:', error);
        }
        await new Promise<void>(r => setTimeout(r, actualHold));
      }
      if (totalMs === Infinity) continue;
      if (performance.now() - startTime >= totalMs) break;
    }

    if (!isStale()) {
      await this.sendFuncStrength(deviceNo, funcCode, 0).catch(() => {});
    }
  }

  private executeTags(tags: MuTag[]): void {
    this.stopExecution();

    const gen = ++this.executionGeneration;
    const isStale = () => gen !== this.executionGeneration;

    for (const tag of tags) {
      this.activeKeys.add(`${tag.deviceNo}:${tag.funcCode}`);
    }

    const cycleTags = tags.filter(t => t.steps.length >= 2);
    const simpleTags = tags.filter(t => t.steps.length < 2);

    for (const tag of cycleTags) {
      const desc = tag.steps.map(s => `${s.strength}(${s.holdTime}s)`).join('-');
      console.log(`[MuCmd] 多强度循环: ${tag.deviceNo}:${tag.funcCode} ${desc}` +
        (tag.duration !== null ? ` 持续${tag.duration}s` : ' 无限循环'));
      this.runCycleLoop(tag, isStale);
    }

    if (simpleTags.length === 0) return;

    const hasDuration = simpleTags.some(t => t.duration !== null && t.duration > 0);

    if (!hasDuration) {
      console.log('[MuCmd] 持续执行标签:', simpleTags.map(t => `${t.deviceNo}:${t.funcCode}:${t.strength}`).join(', '));
      for (const tag of simpleTags) {
        this.sendFuncStrength(tag.deviceNo, tag.funcCode, tag.strength).catch(err =>
          console.error('[MuCmd] 发送失败:', err),
        );
      }
      return;
    }

    let cumulative = 0;
    const queue: QueueItem[] = [];

    for (const tag of simpleTags) {
      const dur = (tag.duration ?? 0) * 1000;
      queue.push({ time: cumulative, deviceNo: tag.deviceNo, funcCode: tag.funcCode, strength: tag.strength });
      if (dur > 0) {
        queue.push({ time: cumulative + dur, deviceNo: tag.deviceNo, funcCode: tag.funcCode, strength: 0 });
        cumulative += dur;
      }
    }
    queue.sort((a, b) => a.time - b.time);

    console.log('[MuCmd] 执行序列:', queue);

    const run = async () => {
      let currentTime = 0;

      for (const item of queue) {
        if (isStale()) return;
        if (item.time > currentTime) {
          await new Promise<void>(r => setTimeout(r, item.time - currentTime));
          currentTime = item.time;
        }
        if (isStale()) return;
        try {
          await this.sendFuncStrength(item.deviceNo, item.funcCode, item.strength);
        } catch (error) {
          console.error('[MuCmd] 指令执行失败:', error);
        }
      }
    };

    run();
  }

  stopExecution(): void {
    this.executionGeneration++;
  }

  reset(): void {
    this.buffer = '';
    this.lastFullTextLength = 0;
    this.stopExecution();

    const keys = [...this.activeKeys];
    this.activeKeys.clear();
    for (const key of keys) {
      const [deviceNo, funcCode] = key.split(':');
      this.sendFuncStrength(deviceNo, funcCode, 0).catch(err =>
        console.error(`[MuCmd] reset 暂停 ${key} 失败:`, err),
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

  const {
    hasConnectedDevice,
    allDeviceInfos,
    deviceScenario,
    promptInjectionEnabled,
    sendFunctionStrengthByDeviceNo,
  } = useBluetooth();

  const updateInjection = () => {
    if (promptInjection) {
      promptInjection.uninject();
      promptInjection = null;
    }

    const infos = allDeviceInfos.value;
    if (hasConnectedDevice.value && infos.length > 0 && promptInjectionEnabled.value) {
      const prompt = buildDevicePrompt(infos, deviceScenario.value);
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

  const deviceSignature = computed(() => {
    const infos = allDeviceInfos.value;
    return JSON.stringify({
      connected: hasConnectedDevice.value,
      devices: infos.map(d => ({ deviceNo: d.deviceNo, productNo: d.productNo })),
      scenario: deviceScenario.value,
      promptInjection: promptInjectionEnabled.value,
    });
  });

  watch(
    deviceSignature,
    () => {
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
      if (hasConnectedDevice.value && allDeviceInfos.value.length > 0) {
        muCmdParser = new MuCmdParser(sendFunctionStrengthByDeviceNo);

        generationStartListener = eventOn(tavern_events.GENERATION_STARTED, (_type, _option, dry_run) => {
          if (dry_run) return;
          if (muCmdParser) muCmdParser.reset();
        });

        streamListener = eventOn(tavern_events.STREAM_TOKEN_RECEIVED, (text: string) => {
          if (muCmdParser) muCmdParser.processIncrement(text);
        });

        console.log('[Bluetooth] 流式监听已启动');
      }
    },
    { immediate: true },
  );

  eventOn(tavern_events.CHAT_CHANGED, () => {
    updateInjection();
  });

  $window.find('.floating-window').draggable({
    handle: '.floating-window__header',
    containment: 'window',
  });

  appendInexistentScriptButtons([{ name: '蓝牙控制', visible: true }]);

  eventOn(getButtonEvent('蓝牙控制'), () => {
    $window.toggle();
  });

  $(window).on('pagehide', () => {
    if (promptInjection) promptInjection.uninject();
    if (streamListener) streamListener.stop();
    if (generationStartListener) generationStartListener.stop();
    if (muCmdParser) muCmdParser.reset();
    app.unmount();
    $window.remove();
    destroy();
  });
});
