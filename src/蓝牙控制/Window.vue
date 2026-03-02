<template>
  <div class="floating-window bluetooth-window">
    <!-- 窗口标题栏 -->
    <div class="floating-window__header">
      <div class="floating-window__header-left" @click="handleHeaderTap">
        <img :src="logoUrl" alt="logo" class="floating-window__logo" />
        <span>MONEU</span>
      </div>
      <div class="floating-window__header-right">
        <!-- 操作图标 -->
        <button
          v-if="!isConnected"
          class="floating-window__btn-icon action-icon"
          :disabled="connecting"
          :title="connecting ? '连接中...' : '搜索设备'"
          @click="handleConnect"
        >
          <i :class="connecting ? 'fas fa-spinner fa-spin' : 'fab fa-bluetooth-b'"></i>
          <span class="action-tooltip">{{ connecting ? '连接中...' : '搜索设备' }}</span>
        </button>
        <button
          v-else
          class="floating-window__btn-icon action-icon action-icon--disconnect"
          title="断开连接"
          @click="handleDisconnect"
        >
          <i class="fas fa-unlink"></i>
          <span class="action-tooltip">断开连接</span>
        </button>
        <button class="floating-window__btn-icon" @click="minimized = !minimized">
          <i :class="minimized ? 'fas fa-chevron-down' : 'fas fa-chevron-up'"></i>
        </button>
      </div>
    </div>

    <!-- 窗口内容区 -->
    <div v-show="!minimized" class="floating-window__content">
      <!-- 连接状态与设备信息 -->
      <div class="floating-window__section">
        <div class="status-bar">
          <div class="status-indicator" :class="{ 'is-connected': isConnected }">
            <i class="fas fa-circle"></i>
            <template v-if="isConnected && deviceInfo">
              <span
                v-if="deviceInfo.bgUrl"
                class="product-avatar-wrapper"
                @mouseenter="updatePreviewPosition"
                @mouseleave="previewVisible = false"
              >
                <img :src="deviceInfo.bgUrl" alt="product" class="product-avatar" />
                <img
                  :src="deviceInfo.bgUrl"
                  alt="product"
                  class="product-preview"
                  :style="previewStyle"
                />
              </span>
              <span>{{ deviceInfo.deviceName || deviceName || '已连接' }}</span>
            </template>
            <span v-else>{{ isConnected ? deviceName || '已连接' : '未连接' }}</span>
          </div>
          <div v-if="isConnected && batteryLevel !== null" class="battery-compact">
            <svg class="battery-icon" viewBox="0 0 32 14" width="24" height="11">
              <rect x="1" y="1" width="25" height="12" rx="2.5" ry="2.5" :stroke="batteryColor" stroke-width="1.5" fill="none" />
              <rect x="27" y="4" width="3" height="6" rx="1" ry="1" :fill="batteryColor" />
              <rect x="3" y="3" :width="(21 * (batteryLevel || 0)) / 100" height="8" rx="1" ry="1" :fill="batteryColor" />
            </svg>
          </div>
        </div>
      </div>

      <!-- 设备控制模块 -->
      <div v-if="isConnected && functions.length > 0" class="floating-window__section">
        <div class="control-header">
          <label class="section-label">设备控制</label>
          <div class="control-header__actions">
            <button class="control-action-btn" :class="{ 'is-active': allPaused }" @click="handlePauseAll">
              <i :class="allPaused ? 'fas fa-play' : 'fas fa-pause'"></i>
              <span class="control-action-tooltip">{{ allPaused ? '恢复所有' : '暂停所有' }}</span>
            </button>
            <button class="control-action-btn" @click="handleResetAll">
              <i class="fas fa-undo"></i>
              <span class="control-action-tooltip">复位滑块</span>
            </button>
          </div>
        </div>
        <div ref="controlZoneRef" class="control-zone">
          <div
            v-for="(func, index) in functions"
            :key="func.funcCode"
            class="func-slider"
            :class="{
              'is-outside': sliderStates[index]?.isOutside,
              'is-paused': sliderStates[index]?.isPaused,
            }"
            :style="getSliderStyle(index)"
            @pointerdown="handleSliderPointerDown($event, index)"
          >
            <img
              v-if="func.funcIconUrl"
              :src="func.funcIconUrl"
              :alt="func.funcDesc"
              class="func-icon"
              draggable="false"
            />
            <i v-else class="fas fa-circle func-icon-fallback"></i>
            <div v-if="sliderStates[index]?.isPaused" class="pause-badge">
              <i class="fas fa-pause"></i>
            </div>
            <div v-if="sliderStates[index]?.isOutside" class="strength-indicator">
              {{ sliderStates[index]?.strength || 0 }}
            </div>
          </div>
        </div>
      </div>

      <!-- 设备使用场景 -->
      <div v-if="isConnected" class="floating-window__section">
        <label class="section-label">设备场景Prompt</label>
        <textarea
          v-model="deviceScenario"
          class="text_pole scenario-textarea"
          placeholder="描述设备使用场景，将追加到 Prompt 中..."
          rows="3"
        ></textarea>
      </div>

      <!-- 调试: 指令发送 -->
      <div v-if="debugMode && isConnected" class="floating-window__section">
        <div class="command-bar">
          <input
            v-model="commandInput"
            class="text_pole command-input"
            placeholder="十六进制指令 (如: AA BB CC)"
            @keyup.enter="handleSendCommand"
          />
          <button
            class="floating-window__btn-icon action-icon"
            :disabled="!commandInput.trim()"
            title="发送指令"
            @click="handleSendCommand"
          >
            <i class="fas fa-paper-plane"></i>
            <span class="action-tooltip">发送</span>
          </button>
        </div>
      </div>

      <!-- 调试: 指令队列测试 -->
      <div v-if="debugMode && isConnected" class="floating-window__section">
        <label class="section-label">指令队列测试</label>
        <textarea
          v-model="queueInput"
          class="text_pole queue-textarea"
          :placeholder="queuePlaceholder"
          rows="4"
        ></textarea>
        <div class="queue-actions">
          <button
            class="floating-window__btn-icon action-icon"
            :disabled="!queueInput.trim() || queueRunning"
            title="执行队列"
            @click="handleExecuteQueue"
          >
            <i class="fas fa-play"></i>
            <span class="action-tooltip">执行</span>
          </button>
          <button
            v-if="queueRunning"
            class="floating-window__btn-icon action-icon action-icon--disconnect"
            title="停止执行"
            @click="handleStopQueue"
          >
            <i class="fas fa-stop"></i>
            <span class="action-tooltip">停止</span>
          </button>
        </div>
      </div>

      <!-- 波形图表: 连接后持续展示，波形结束后保留旧数据 -->
      <WaveformChart v-if="isConnected" :waveform-data="waveformData" :current-time="waveformCurrentTime" :is-active="waveformActive" @replay="handleReplay" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRafFn } from '@vueuse/core';
import { throttle } from 'lodash';
import logoUrl from './logo.png?url';
import { useBluetooth, type FunctionInfo } from './useBluetooth';
import { useWaveform } from './useWaveform';
import WaveformChart from './WaveformChart.vue';

const minimized = ref(false);
const debugMode = ref(false);
const commandInput = ref('');
const controlZoneRef = ref<HTMLElement | null>(null);

const previewVisible = ref(false);
const previewPos = ref({ top: 0, left: 0 });
const previewStyle = computed(() => ({
  top: `${previewPos.value.top}px`,
  left: `${previewPos.value.left}px`,
  opacity: previewVisible.value ? 1 : 0,
  visibility: previewVisible.value ? 'visible' as const : 'hidden' as const,
}));

function updatePreviewPosition(e: MouseEvent) {
  const avatar = (e.currentTarget as HTMLElement).querySelector('.product-avatar');
  if (!avatar) return;
  const rect = avatar.getBoundingClientRect();
  const previewSize = 160;
  previewPos.value = {
    top: rect.bottom + 8,
    left: rect.left + rect.width / 2 - previewSize / 2,
  };
  previewVisible.value = true;
}
const queueInput = ref('[1000,[[100,["01",30]],[200,["01",60]],[300,["01",90]],[400,["01",60]],[500,["01",30]]]]');
const queuePlaceholder = '[1000,[[100,["01",30]],[200,["01",60]],[300,["01",90]]]]';
const queueRunning = ref(false);
let queueAborted = false;
let activeFuncCodes: string[] = [];
const lastExecutedQueue = ref<string | null>(null);

const DEBUG_TAP_COUNT = 5;
const DEBUG_TAP_WINDOW = 2000;
const headerTapTimestamps: number[] = [];

function handleHeaderTap() {
  const now = Date.now();
  headerTapTimestamps.push(now);
  while (headerTapTimestamps.length > 0 && now - headerTapTimestamps[0] > DEBUG_TAP_WINDOW) {
    headerTapTimestamps.shift();
  }
  if (headerTapTimestamps.length >= DEBUG_TAP_COUNT) {
    debugMode.value = !debugMode.value;
    headerTapTimestamps.length = 0;
    toastr.info(debugMode.value ? '调试模式已开启' : '调试模式已关闭');
  }
}

const {
  isConnected,
  connecting,
  deviceName,
  batteryLevel,
  deviceScenario,
  deviceInfo,
  connect,
  disconnect,
  send,
  sendFunctionStrength,
} = useBluetooth();
const { waveformData, waveformCurrentTime, waveformActive, lastCommandRaw, requestStopExecution } = useWaveform();

// 功能点列表
const functions = computed<FunctionInfo[]>(() => deviceInfo.value?.runtimeConf?.functions || []);

// 滑块状态
interface SliderState {
  x: number;
  y: number;
  fixedX: number;
  fixedY: number;
  isOutside: boolean;
  isPinned: boolean;
  strength: number;
  isDragging: boolean;
  isPaused: boolean;
  pausedStrength: number;
}

const sliderStates = ref<SliderState[]>([]);
const SLIDER_SIZE = 40;
const SLIDER_GAP = 12;
const ZONE_HEIGHT = 120;

function getCenteredPositions(count: number): Array<{ x: number; y: number }> {
  const zoneWidth = controlZoneRef.value?.clientWidth || 270;
  const columns = Math.min(count, 4);
  const rows = Math.ceil(count / columns);
  const totalW = columns * SLIDER_SIZE + (columns - 1) * SLIDER_GAP;
  const totalH = rows * SLIDER_SIZE + (rows - 1) * SLIDER_GAP;
  const startX = (zoneWidth - totalW) / 2;
  const startY = (ZONE_HEIGHT - totalH) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + (i % columns) * (SLIDER_SIZE + SLIDER_GAP),
    y: startY + Math.floor(i / columns) * (SLIDER_SIZE + SLIDER_GAP),
  }));
}

watch(
  functions,
  (newFuncs: FunctionInfo[]) => {
    nextTick(() => {
      const positions = getCenteredPositions(newFuncs.length);
      sliderStates.value = newFuncs.map((_: FunctionInfo, index: number) => ({
        ...positions[index],
        fixedX: 0,
        fixedY: 0,
        isOutside: false,
        isPinned: false,
        strength: 0,
        isDragging: false,
        isPaused: false,
        pausedStrength: 0,
      }));
    });
  },
  { immediate: true },
);

const batteryColor = computed(() => {
  if (batteryLevel.value === null) return '#909399';
  if (batteryLevel.value <= 20) return '#f56c6c';
  if (batteryLevel.value <= 50) return '#e6a23c';
  return '#67c23a';
});

function getSliderStyle(index: number): Record<string, string> {
  const state = sliderStates.value[index];
  if (!state) return {};
  if (state.isDragging || state.isPinned) {
    return {
      position: 'fixed',
      left: `${state.fixedX}px`,
      top: `${state.fixedY}px`,
      transform: 'none',
      zIndex: '99999',
    };
  }
  return {
    transform: `translate(${state.x}px, ${state.y}px)`,
  };
}

// 页面四角到 controlZone 中点的最远距离（窗体拖动时实时更新）
const cachedMaxDistance = ref(0);

function getParentViewport(): { width: number; height: number } {
  try {
    const p = window.parent || window.top;
    if (p && p !== window) {
      return { width: p.innerWidth, height: p.innerHeight };
    }
  } catch { /* cross-origin fallback */ }
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

function updateMaxDistance() {
  if (!controlZoneRef.value) return;
  const zoneRect = controlZoneRef.value.getBoundingClientRect();
  const { width: pageWidth, height: pageHeight } = getParentViewport();
  const zoneCenterX = zoneRect.left + zoneRect.width / 2;
  const zoneCenterY = zoneRect.top + zoneRect.height / 2;

  const corners: Array<[number, number]> = [
    [0, 0],
    [pageWidth, 0],
    [0, pageHeight],
    [pageWidth, pageHeight],
  ];

  const distances = corners.map(([x, y]) => Math.sqrt((x - zoneCenterX) ** 2 + (y - zoneCenterY) ** 2));
  cachedMaxDistance.value = Math.max(...distances);

  console.log('[Slider] zoneCenter:', { zoneCenterX: Math.round(zoneCenterX), zoneCenterY: Math.round(zoneCenterY) },
    'corners dist:', distances.map(d => Math.round(d)),
    'max:', Math.round(cachedMaxDistance.value),
    'page:', { w: pageWidth, h: pageHeight });
}

// 计算滑块是否在虚线框外及强度
function calculateStrength(
  sliderX: number,
  sliderY: number,
  zoneRect: DOMRect,
  func: FunctionInfo,
): { isOutside: boolean; strength: number } {
  // 用滑块边缘判断"是否越出虚线框"
  const distX = Math.max(0, -sliderX, sliderX + SLIDER_SIZE - zoneRect.width);
  const distY = Math.max(0, -sliderY, sliderY + SLIDER_SIZE - zoneRect.height);
  const isOutside = distX > 0 || distY > 0;

  if (!isOutside) {
    return { isOutside: false, strength: 0 };
  }

  // 计算滑块中心到虚线框中心的距离
  const sliderCenterX = zoneRect.left + sliderX + SLIDER_SIZE / 2;
  const sliderCenterY = zoneRect.top + sliderY + SLIDER_SIZE / 2;
  const zoneCenterX = zoneRect.left + zoneRect.width / 2;
  const zoneCenterY = zoneRect.top + zoneRect.height / 2;

  const distanceToCenter = Math.sqrt((sliderCenterX - zoneCenterX) ** 2 + (sliderCenterY - zoneCenterY) ** 2);
  const zoneRadius = Math.sqrt((zoneRect.width / 2) ** 2 + (zoneRect.height / 2) ** 2);
  const overflow = Math.max(0, distanceToCenter - zoneRadius);
  const maxOverflow = Math.max(0, cachedMaxDistance.value - zoneRadius);

  const ratio = Math.min(overflow / (maxOverflow || 1), 1);
  const strength = Math.round(func.minStrength + ratio * (func.maxStrength - func.minStrength));

  return { isOutside, strength };
}

// 节流发送指令
const throttledSendStrength = throttle((funcCode: string, strength: number) => {
  sendFunctionStrength(funcCode, strength);
}, 100);

const DRAG_THRESHOLD = 5;
const DBLCLICK_INTERVAL = 300;
const lastClickTimes: number[] = [];

function resetSingleSlider(index: number) {
  const positions = getCenteredPositions(functions.value.length);
  const state = sliderStates.value[index];
  const func = functions.value[index];
  if (!state || !func) return;

  state.x = positions[index].x;
  state.y = positions[index].y;
  state.fixedX = 0;
  state.fixedY = 0;
  state.isOutside = false;
  state.isPinned = false;
  state.strength = 0;
  state.isPaused = false;
  state.pausedStrength = 0;
  sendFunctionStrength(func.funcCode, 0);
  toastr.info(`已复位 ${func.funcDesc || func.funcCode}`);
}

function toggleSliderPause(index: number) {
  const state = sliderStates.value[index];
  const func = functions.value[index];
  if (!state || !func || !state.isPinned) return;

  if (state.isPaused) {
    state.isPaused = false;
    sendFunctionStrength(func.funcCode, state.pausedStrength);
    state.strength = state.pausedStrength;
  } else {
    state.isPaused = true;
    state.pausedStrength = state.strength;
    sendFunctionStrength(func.funcCode, 0);
  }
}

function handleSliderPointerDown(event: PointerEvent, index: number) {
  event.preventDefault();
  const state = sliderStates.value[index];
  if (!state || !controlZoneRef.value) return;

  updateMaxDistance();
  const zoneRect = controlZoneRef.value.getBoundingClientRect();
  const func = functions.value[index];

  const initialFixedX = zoneRect.left + state.x;
  const initialFixedY = zoneRect.top + state.y;
  state.fixedX = initialFixedX;
  state.fixedY = initialFixedY;
  state.isDragging = true;

  const startX = event.clientX;
  const startY = event.clientY;
  let hasMoved = false;

  const offsetX = event.clientX - initialFixedX;
  const offsetY = event.clientY - initialFixedY;

  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);

  const handlePointerMove = (e: PointerEvent) => {
    if (!hasMoved) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      hasMoved = true;
      if (state.isPaused) {
        state.isPaused = false;
      }
    }

    const newFixedX = e.clientX - offsetX;
    const newFixedY = e.clientY - offsetY;
    state.fixedX = newFixedX;
    state.fixedY = newFixedY;

    const relX = newFixedX - zoneRect.left;
    const relY = newFixedY - zoneRect.top;
    state.x = relX;
    state.y = relY;

    const { isOutside, strength } = calculateStrength(relX, relY, zoneRect, func);
    state.isOutside = isOutside;
    state.strength = strength;

    throttledSendStrength(func.funcCode, strength);
  };

  const handlePointerUp = () => {
    state.isDragging = false;
    target.releasePointerCapture(event.pointerId);
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerup', handlePointerUp);
    target.removeEventListener('lostpointercapture', handlePointerUp);

    if (!hasMoved && state.isPinned) {
      const now = Date.now();
      const lastClick = lastClickTimes[index] || 0;
      if (now - lastClick < DBLCLICK_INTERVAL) {
        lastClickTimes[index] = 0;
        resetSingleSlider(index);
        return;
      }
      lastClickTimes[index] = now;
      toggleSliderPause(index);
      return;
    }

    state.isPinned = state.isOutside;
  };

  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerup', handlePointerUp);
  target.addEventListener('lostpointercapture', handlePointerUp);
}

// 窗体拖拽时重算外部滑块的强度（RAF 轮询，仅在有外部滑块时启动）
function recalcOutsideSliders() {
  if (!controlZoneRef.value) return;
  const zoneRect = controlZoneRef.value.getBoundingClientRect();

  sliderStates.value.forEach((state: SliderState, index: number) => {
    if (!state.isPinned || state.isDragging) return;

    const relX = state.fixedX - zoneRect.left;
    const relY = state.fixedY - zoneRect.top;
    state.x = relX;
    state.y = relY;

    if (state.isPaused) return;

    const func = functions.value[index];
    if (!func) return;

    const { isOutside, strength } = calculateStrength(relX, relY, zoneRect, func);
    state.isOutside = isOutside;
    state.strength = strength;
    throttledSendStrength(func.funcCode, strength);
  });
}

let lastZoneLeft = -1;
let lastZoneTop = -1;
let lastWindowWidth = -1;
let lastWindowHeight = -1;

const { pause: pauseZonePolling, resume: resumeZonePolling } = useRafFn(
  () => {
    if (!controlZoneRef.value) return;
    const rect = controlZoneRef.value.getBoundingClientRect();
    const vp = getParentViewport();
    if (
      rect.left !== lastZoneLeft ||
      rect.top !== lastZoneTop ||
      vp.width !== lastWindowWidth ||
      vp.height !== lastWindowHeight
    ) {
      lastZoneLeft = rect.left;
      lastZoneTop = rect.top;
      lastWindowWidth = vp.width;
      lastWindowHeight = vp.height;
      updateMaxDistance();
      recalcOutsideSliders();
    }
  },
  { immediate: false },
);

watch(
  () => sliderStates.value.some((s: SliderState) => s.isPinned && !s.isDragging),
  (hasPinned: boolean) => {
    if (hasPinned) {
      lastZoneLeft = -1;
      lastZoneTop = -1;
      lastWindowWidth = -1;
      lastWindowHeight = -1;
      resumeZonePolling();
    } else {
      pauseZonePolling();
    }
  },
);

const allPaused = computed(() => {
  const pinned = sliderStates.value.filter((s: SliderState) => s.isPinned);
  return pinned.length > 0 && pinned.every((s: SliderState) => s.isPaused);
});

function handlePauseAll() {
  const shouldResume = allPaused.value;

  if (shouldResume) {
    sliderStates.value.forEach((state: SliderState, index: number) => {
      if (!state.isPinned) return;
      const func = functions.value[index];
      if (!func) return;
      state.isPaused = false;
      sendFunctionStrength(func.funcCode, state.pausedStrength);
      state.strength = state.pausedStrength;
    });
    return;
  }

  // Stop the local queue execution
  if (queueRunning.value) {
    queueAborted = true;
  }

  // Stop MuCmdParser execution from index.ts
  requestStopExecution();

  // Pause all pinned sliders and send strength 0 to every function code
  const sentCodes = new Set<string>();
  sliderStates.value.forEach((state: SliderState, index: number) => {
    if (!state.isPinned) return;
    const func = functions.value[index];
    if (!func) return;
    state.isPaused = true;
    state.pausedStrength = state.strength;
    sendFunctionStrength(func.funcCode, 0);
    sentCodes.add(func.funcCode);
  });

  for (const func of functions.value) {
    if (!sentCodes.has(func.funcCode)) {
      sendFunctionStrength(func.funcCode, 0);
    }
  }
}

function handleResetAll() {
  const positions = getCenteredPositions(functions.value.length);
  functions.value.forEach((func: FunctionInfo, index: number) => {
    const state = sliderStates.value[index];
    if (state) {
      state.x = positions[index].x;
      state.y = positions[index].y;
      state.fixedX = 0;
      state.fixedY = 0;
      state.isOutside = false;
      state.isPinned = false;
      state.strength = 0;
      state.isPaused = false;
      state.pausedStrength = 0;
      sendFunctionStrength(func.funcCode, 0);
    }
  });
  toastr.info('已复位所有滑块');
}

function handleConnect() {
  connect();
}

function handleDisconnect() {
  disconnect();
  toastr.info('已断开蓝牙连接');
}

async function handleSendCommand() {
  const cmd = commandInput.value.trim();
  if (!cmd) {
    toastr.warning('请输入指令');
    return;
  }

  try {
    await send(cmd);
    toastr.success('指令发送成功');
    commandInput.value = '';
  } catch (error) {
    toastr.error(`发送失败: ${(error as Error).message}`);
  }
}

function parseFuncUnits(element: unknown[]): Array<{ funcCode: string; strength: number }> {
  const units: Array<{ funcCode: string; strength: number }> = [];
  for (const item of element.slice(1)) {
    if (!Array.isArray(item)) continue;
    if (typeof item[0] === 'string') {
      units.push({ funcCode: item[0] as string, strength: item[1] as number });
    } else if (Array.isArray(item[0])) {
      for (const pair of item) {
        if (Array.isArray(pair) && typeof pair[0] === 'string') {
          units.push({ funcCode: pair[0] as string, strength: pair[1] as number });
        }
      }
    }
  }
  return units;
}

function handleReplay() {
  if (queueRunning.value) return;
  if (lastExecutedQueue.value) {
    queueInput.value = lastExecutedQueue.value;
    handleExecuteQueue();
  } else if (lastCommandRaw.value) {
    queueInput.value = lastCommandRaw.value;
    handleExecuteQueue();
  }
}

async function handleExecuteQueue() {
  const input = queueInput.value.trim();
  if (!input) return;
  lastExecutedQueue.value = input;
  lastCommandRaw.value = input;

  let parsed: unknown[];
  try {
    parsed = JSON.parse(input);
  } catch {
    toastr.error('JSON 解析失败，请检查格式');
    return;
  }

  if (!Array.isArray(parsed) || parsed.length < 2) {
    toastr.error('格式错误: 期望 [全局时间, 指令集]');
    return;
  }

  const globalTime = parsed[0] as number;
  const rawCommands = parsed[1] as unknown[][];
  if (!Array.isArray(rawCommands) || rawCommands.length === 0) {
    toastr.error('指令集为空');
    return;
  }

  interface QueueCmd { time: number; funcUnits: Array<{ funcCode: string; strength: number }>; }
  interface QueueItem { time: number; funcCode: string; strength: number; }

  let cumulativeTime = 0;
  const commands: QueueCmd[] = rawCommands.map((el: unknown[]) => {
    const duration = el[0] as number;
    const cmd: QueueCmd = { time: cumulativeTime, funcUnits: parseFuncUnits(el) };
    cumulativeTime += duration;
    return cmd;
  });
  const totalDuration = cumulativeTime;
  const cycleTime = totalDuration > 0 ? totalDuration : 1;

  const queue: QueueItem[] = [];
  for (const cmd of commands) {
    for (const fu of cmd.funcUnits) {
      queue.push({ time: cmd.time, funcCode: fu.funcCode, strength: fu.strength });
    }
  }
  queue.sort((a, b) => a.time - b.time);

  // console.log('[QueueTest] 解析指令:', { globalTime, cycleTime, commands, queue });

  const waveformPoints: Array<{ funcCode: string; time: number; strength: number }> = [];
  for (const cmd of commands) {
    for (const fu of cmd.funcUnits) {
      waveformPoints.push({ funcCode: fu.funcCode, time: cmd.time, strength: fu.strength });
    }
  }
  waveformData.value = { globalTime: cycleTime, commands: waveformPoints };
  waveformActive.value = true;

  queueAborted = false;
  queueRunning.value = true;
  const funcCodes: string[] = [...new Set(queue.map((item: QueueItem) => item.funcCode))];
  activeFuncCodes = funcCodes;
  const startedAt = Date.now();
  let loopStartTime = startedAt;

  const cappedWait = (ms: number): Promise<void> => {
    if (globalTime > 0) {
      const rem = globalTime - (Date.now() - startedAt);
      if (rem <= 0) { queueAborted = true; return Promise.resolve(); }
      return new Promise(r => setTimeout(r, Math.min(ms, rem)));
    }
    return new Promise(r => setTimeout(r, ms));
  };

  const checkExpired = (): boolean => {
    if (globalTime > 0 && Date.now() - startedAt >= globalTime) {
      queueAborted = true;
      return true;
    }
    return false;
  };

  const timeTracker = setInterval(() => {
    waveformCurrentTime.value = (Date.now() - loopStartTime) % cycleTime;
  }, 50);

  try {
    const executeOnce = async () => {
      let currentTime = 0;
      loopStartTime = Date.now();
      for (const item of queue) {
        if (queueAborted) return;
        if (item.time > currentTime) {
          await cappedWait(item.time - currentTime);
          currentTime = item.time;
        }
        if (queueAborted || checkExpired()) return;
        // console.log(`[QueueTest] funcCode=${item.funcCode}, 强度=${item.strength}, @${item.time}ms`);
        await sendFunctionStrength(item.funcCode, item.strength);
      }
      if (queueAborted || checkExpired()) return;
      const remaining = cycleTime - currentTime;
      if (remaining > 0) await cappedWait(remaining);
    };

    while (!queueAborted) {
      await executeOnce();
      checkExpired();
    }
  } finally {
    clearInterval(timeTracker);
    for (const fc of activeFuncCodes) {
      try { await sendFunctionStrength(fc, 0); } catch { /* noop */ }
    }
    activeFuncCodes = [];
    queueRunning.value = false;
    waveformCurrentTime.value = 0;
    waveformActive.value = false;
  }
}

function handleStopQueue() {
  queueAborted = true;
  toastr.info('已停止指令队列');
}
</script>

<style scoped>
.floating-window__header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-icon {
  position: relative;
  color: var(--SmartThemeBodyColor);
  transition: color 0.2s ease;
}

.action-icon:hover {
  color: var(--SmartThemeQuoteColor);
}

.action-icon--disconnect:hover {
  color: #f56c6c;
}

.action-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-tooltip {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 6px;
  padding: 4px 8px;
  background: var(--SmartThemeBlurTintColor);
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s ease,
    visibility 0.2s ease;
  pointer-events: none;
  z-index: 100;
}

.action-icon:hover .action-tooltip {
  opacity: 1;
  visibility: visible;
}

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--SmartThemeBodyColor);
}

.status-indicator i {
  font-size: 8px;
  color: #909399;
}

.status-indicator.is-connected i {
  color: #67c23a;
}

.product-avatar-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.product-avatar {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  object-fit: cover;
  cursor: pointer;
}

.product-preview {
  position: fixed;
  width: 160px;
  height: 160px;
  object-fit: contain;
  border-radius: 8px;
  background: var(--SmartThemeBlurTintColor);
  border: 1px solid var(--SmartThemeBorderColor);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s ease,
    visibility 0.2s ease;
  pointer-events: none;
  z-index: 10000;
}

.battery-compact {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--SmartThemeBodyColor);
}

.command-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.command-bar .command-input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 6px 10px;
}

.command-bar .action-icon {
  flex-shrink: 0;
}

.section-label {
  display: block;
  font-size: 12px;
  color: var(--SmartThemeBodyColor);
  margin-bottom: 6px;
  opacity: 0.8;
}

.scenario-textarea {
  width: 100%;
  min-height: 60px;
  resize: vertical;
  font-size: 12px;
  line-height: 1.4;
  padding: 8px 10px;
}

.queue-textarea {
  width: 100%;
  min-height: 60px;
  resize: vertical;
  font-size: 12px;
  font-family: monospace;
  line-height: 1.4;
  padding: 8px 10px;
  margin-bottom: 6px;
}

.queue-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 设备控制模块样式 */
.control-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.control-header .section-label {
  margin-bottom: 0;
}

.control-header__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.control-action-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 11px;
  color: var(--SmartThemeBodyColor);
  background: transparent;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.control-action-btn:hover {
  background: var(--SmartThemeBlurTintColor);
  border-color: var(--SmartThemeQuoteColor);
  color: var(--SmartThemeQuoteColor);
}

.control-action-btn.is-active {
  border-color: #e6a23c;
  color: #e6a23c;
}

.control-action-btn.is-active:hover {
  border-color: #67c23a;
  color: #67c23a;
}

.control-action-btn i {
  font-size: 10px;
}

.control-action-tooltip {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  padding: 4px 8px;
  background: var(--SmartThemeBlurTintColor);
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s ease,
    visibility 0.2s ease;
  pointer-events: none;
  z-index: 100;
}

.control-action-btn:hover .control-action-tooltip {
  opacity: 1;
  visibility: visible;
}

.control-zone {
  position: relative;
  width: 100%;
  height: 120px;
  border: 2px dashed var(--SmartThemeBorderColor);
  border-radius: 8px;
  background: linear-gradient(
    135deg,
    rgba(var(--SmartThemeBodyColorRGB), 0.02) 0%,
    rgba(var(--SmartThemeBodyColorRGB), 0.05) 100%
  );
  overflow: visible;
}

.func-slider {
  position: absolute;
  width: 40px;
  height: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--SmartThemeBlurTintColor);
  border: 2px solid var(--SmartThemeBorderColor);
  border-radius: 50%;
  cursor: grab;
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease;
  user-select: none;
  touch-action: none;
  z-index: 10;
}

.func-slider:hover {
  border-color: var(--SmartThemeQuoteColor);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.func-slider:active {
  cursor: grabbing;
}

.func-slider.is-outside {
  border-color: #e6a23c;
  box-shadow: 0 0 12px rgba(230, 162, 60, 0.4);
  z-index: 20;
}

.func-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
}

.func-icon-fallback {
  font-size: 16px;
  color: var(--SmartThemeBodyColor);
  opacity: 0.6;
}

.func-slider.is-paused {
  border-color: #909399;
  opacity: 0.65;
  box-shadow: 0 0 8px rgba(144, 147, 153, 0.3);
}

.pause-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #909399;
  border-radius: 50%;
  font-size: 7px;
  color: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.strength-indicator {
  position: absolute;
  bottom: -20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #e6a23c 0%, #f56c6c 100%);
  border-radius: 10px;
  white-space: nowrap;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
</style>
