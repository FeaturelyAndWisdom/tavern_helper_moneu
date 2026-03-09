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
你现在连接到了用户的情趣玩具。根据剧情中发生的情节与角色行为，在回复中插入控制标签来给用户真实的反馈。

[设备信息]
${functionInfoStr}

语法格式：[MU:设备编号:设备功能点:功能点强度:持续时间(可选,单位秒)]
参数说明：
- 设备编号：支持同时连接多设备，每个指令需要声明设备编号
- 设备功能点：每个设备可能存在多个功能点，每个功能点作用不同，视情况进行控制，每个功能点是独立的。
- 强度大小：功能点输出强度。
- 持续时间：可选，默认持续执行，不支持小数。

示例：
- *轻轻捏了一下你的手臂* 别发呆了。[MU:${deviceInfos[0]?.deviceNo || 'XX'}:01:15]
- 既然你犯了错，就得接受惩罚。[MU:${deviceInfos[0]?.deviceNo || 'XX'}:01:25]
- *快速的连续鞭打* [MU:${deviceInfos[0]?.deviceNo || 'XX'}:01:10:2] [MU:${deviceInfos[0]?.deviceNo || 'XX'}:01:15:3] [MU:${deviceInfos[0]?.deviceNo || 'XX'}:01:20:4]
- *跪下！* [MU:${deviceInfos[0]?.deviceNo || 'XX'}:01:40:10]

注意：标签不应包含额外文本，仅输出标签即可。并且只能在正文中输出，不得在如思维链等其他任何部分输出完整的标签。`;
}

/**
 * 解析 [MU:deviceNo:funcCode:strength:duration?] 标签
 * 
 * - [MU:deviceNo:funcCode:strength] → 持续执行
 * - [MU:deviceNo:funcCode:strength:duration] → 执行 duration 秒后归零
 */
interface MuTag {
  deviceNo: string;
  funcCode: string;
  strength: number;
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
      const strength = parseInt(parts[2], 10);
      const duration = parts.length >= 4 ? parseInt(parts[3], 10) : null;

      if (isNaN(strength)) {
        console.warn(`[MuCmd] 无效强度值: ${match[0]}`);
        continue;
      }
      if (duration !== null && isNaN(duration)) {
        console.warn(`[MuCmd] 无效持续时间: ${match[0]}`);
        continue;
      }

      tags.push({ deviceNo, funcCode, strength, duration });
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

  private executeTags(tags: MuTag[]): void {
    this.stopExecution();

    const gen = ++this.executionGeneration;
    const isStale = () => gen !== this.executionGeneration;

    const hasDuration = tags.some(t => t.duration !== null && t.duration > 0);

    if (!hasDuration) {
      console.log('[MuCmd] 持续执行标签:', tags.map(t => `${t.deviceNo}:${t.funcCode}:${t.strength}`).join(', '));
      for (const tag of tags) {
        const key = `${tag.deviceNo}:${tag.funcCode}`;
        this.activeKeys.add(key);
        this.sendFuncStrength(tag.deviceNo, tag.funcCode, tag.strength).catch(err =>
          console.error('[MuCmd] 发送失败:', err),
        );
      }
      return;
    }

    let cumulative = 0;
    const queue: QueueItem[] = [];

    for (const tag of tags) {
      const key = `${tag.deviceNo}:${tag.funcCode}`;
      this.activeKeys.add(key);
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
    sendFunctionStrengthByDeviceNo,
  } = useBluetooth();

  const updateInjection = () => {
    if (promptInjection) {
      promptInjection.uninject();
      promptInjection = null;
    }

    const infos = allDeviceInfos.value;
    if (hasConnectedDevice.value && infos.length > 0) {
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
