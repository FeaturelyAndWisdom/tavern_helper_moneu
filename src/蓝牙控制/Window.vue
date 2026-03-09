<template>
  <div class="floating-window bluetooth-window">
    <!-- 窗口标题栏 -->
    <div class="floating-window__header">
      <div class="floating-window__header-left" @click="handleHeaderTap">
        <img :src="logoUrl" alt="logo" class="floating-window__logo" />
        <span>MONEU</span>
      </div>
      <div class="floating-window__header-right">
        <button
          class="floating-window__btn-icon action-icon"
          :disabled="connecting"
          :title="connecting ? '连接中...' : '搜索设备'"
          @click="handleConnect"
        >
          <i :class="connecting ? 'fas fa-spinner fa-spin' : 'fab fa-bluetooth-b'"></i>
          <span class="action-tooltip">{{ connecting ? '连接中...' : '添加设备' }}</span>
        </button>
        <button
          v-if="connectedDevices.length > 0"
          class="floating-window__btn-icon action-icon action-icon--disconnect"
          title="断开所有"
          @click="handleDisconnectAll"
        >
          <i class="fas fa-unlink"></i>
          <span class="action-tooltip">断开所有</span>
        </button>
        <button class="floating-window__btn-icon" @click="minimized = !minimized">
          <i :class="minimized ? 'fas fa-chevron-down' : 'fas fa-chevron-up'"></i>
        </button>
      </div>
    </div>

    <!-- 窗口内容区 -->
    <div v-show="!minimized" class="floating-window__content">
      <!-- 无设备连接 -->
      <div v-if="connectedDevices.length === 0" class="floating-window__section">
        <div class="status-bar">
          <div class="status-indicator">
            <i class="fas fa-circle"></i>
            <span>未连接</span>
          </div>
        </div>
      </div>

      <!-- 多设备列表 -->
      <div
        v-for="dev in connectedDevices"
        :key="dev.id"
        class="device-card"
      >
        <!-- 设备状态栏 -->
        <div class="floating-window__section">
          <div class="status-bar">
            <div class="status-indicator is-connected">
              <i class="fas fa-circle"></i>
              <span
                v-if="dev.deviceInfo?.bgUrl"
                class="product-avatar-wrapper"
                @mouseenter="updatePreviewPosition($event, dev)"
                @mouseleave="previewVisible = false"
              >
                <svg class="battery-ring" viewBox="0 0 36 36">
                  <circle class="battery-ring__track" cx="18" cy="18" r="16" />
                  <circle
                    class="battery-ring__fill"
                    cx="18" cy="18" r="16"
                    :stroke="getBatteryColor(dev.batteryLevel)"
                    :stroke-dasharray="getBatteryDashArray(dev.batteryLevel)"
                    stroke-dashoffset="0"
                  />
                </svg>
                <img :src="dev.deviceInfo.bgUrl" alt="product" class="product-avatar" />
              </span>
              <span v-else-if="dev.batteryLevel !== null" class="product-avatar-wrapper product-avatar-wrapper--no-img">
                <svg class="battery-ring" viewBox="0 0 36 36">
                  <circle class="battery-ring__track" cx="18" cy="18" r="16" />
                  <circle
                    class="battery-ring__fill"
                    cx="18" cy="18" r="16"
                    :stroke="getBatteryColor(dev.batteryLevel)"
                    :stroke-dasharray="getBatteryDashArray(dev.batteryLevel)"
                    stroke-dashoffset="0"
                  />
                </svg>
                <i class="fas fa-microchip product-avatar-placeholder"></i>
              </span>
              <span>{{ dev.deviceInfo?.deviceName || dev.name || '已连接' }}</span>
            </div>
            <button
              class="floating-window__btn-icon action-icon action-icon--disconnect device-disconnect-btn"
              title="断开此设备"
              @click="handleDisconnectOne(dev.id)"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>

        <!-- 设备控制模块 -->
        <div v-if="getDeviceFunctions(dev).length > 0" class="floating-window__section">
          <div class="control-header">
            <label class="section-label">设备控制</label>
            <div class="control-header__actions">
              <button class="control-action-btn" :class="{ 'is-active': isDeviceAllPaused(dev.id) }" @click="handlePauseDevice(dev.id)">
                <i :class="isDeviceAllPaused(dev.id) ? 'fas fa-play' : 'fas fa-pause'"></i>
                <span class="control-action-tooltip">{{ isDeviceAllPaused(dev.id) ? '恢复' : '暂停' }}</span>
              </button>
              <button class="control-action-btn" @click="handleResetDevice(dev.id)">
                <i class="fas fa-undo"></i>
                <span class="control-action-tooltip">复位</span>
              </button>
            </div>
          </div>
          <div :ref="el => setControlZoneRef(dev.id, el as HTMLElement)" class="control-zone">
            <div
              v-for="(func, fIdx) in getDeviceFunctions(dev)"
              :key="func.funcCode"
              class="func-slider"
              :class="{
                'is-outside': getSliderState(dev.id, fIdx)?.isOutside,
                'is-paused': getSliderState(dev.id, fIdx)?.isPaused,
              }"
              :style="getSliderStyle(dev.id, fIdx)"
              @pointerdown="handleSliderPointerDown($event, dev.id, fIdx)"
            >
              <img
                v-if="func.funcIconUrl"
                :src="func.funcIconUrl"
                :alt="func.funcDesc"
                class="func-icon"
                draggable="false"
              />
              <i v-else class="fas fa-circle func-icon-fallback"></i>
              <div v-if="getSliderState(dev.id, fIdx)?.isPaused" class="pause-badge">
                <i class="fas fa-pause"></i>
              </div>
              <div v-if="getSliderState(dev.id, fIdx)?.isOutside" class="strength-indicator">
                {{ getSliderState(dev.id, fIdx)?.strength || 0 }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 调试: 指令发送 -->
      <div v-if="debugMode && connectedDevices.length > 0" class="floating-window__section">
        <div class="command-bar">
          <select v-model="debugDeviceId" class="text_pole debug-device-select">
            <option v-for="dev in connectedDevices" :key="dev.id" :value="dev.id">
              {{ dev.deviceInfo?.deviceName || dev.name }}
            </option>
          </select>
          <input
            v-model="commandInput"
            class="text_pole command-input"
            placeholder="十六进制指令 (如: AA BB CC)"
            @keyup.enter="handleSendCommand"
          />
          <button
            class="floating-window__btn-icon action-icon"
            :disabled="!commandInput.trim() || !debugDeviceId"
            title="发送指令"
            @click="handleSendCommand"
          >
            <i class="fas fa-paper-plane"></i>
            <span class="action-tooltip">发送</span>
          </button>
        </div>
      </div>

      <!-- 调试: 指令队列测试 -->
      <div v-if="debugMode && connectedDevices.length > 0" class="floating-window__section">
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

      <!-- 产品预览浮层 -->
      <img
        v-if="previewSrc"
        :src="previewSrc"
        alt="product"
        class="product-preview"
        :style="previewStyle"
      />

    </div>
  </div>
</template>

<script setup lang="ts">
import { useRafFn } from '@vueuse/core';
import { throttle } from 'lodash';
import logoUrl from './logo.png?url';
import { useBluetooth, type FunctionInfo, type ConnectedDevice } from './useBluetooth';
const minimized = ref(false);
const debugMode = ref(false);
const commandInput = ref('');
const debugDeviceId = ref('');

const previewVisible = ref(false);
const previewSrc = ref('');
const previewPos = ref({ top: 0, left: 0 });
const previewStyle = computed(() => ({
  top: `${previewPos.value.top}px`,
  left: `${previewPos.value.left}px`,
  opacity: previewVisible.value ? 1 : 0,
  visibility: previewVisible.value ? 'visible' as const : 'hidden' as const,
}));

function updatePreviewPosition(e: MouseEvent, dev: ConnectedDevice) {
  const avatar = (e.currentTarget as HTMLElement).querySelector('.product-avatar');
  if (!avatar) return;
  const rect = avatar.getBoundingClientRect();
  const previewSize = 160;
  previewPos.value = {
    top: rect.bottom + 8,
    left: rect.left + rect.width / 2 - previewSize / 2,
  };
  previewSrc.value = dev.deviceInfo?.bgUrl || '';
  previewVisible.value = true;
}

const queueInput = ref('[1000,[[100,["01",30]],[200,["01",60]],[300,["01",90]],[400,["01",60]],[500,["01",30]]]]');
const queuePlaceholder = '[1000,[[100,["01",30]],[200,["01",60]],[300,["01",90]]]]';
const queueRunning = ref(false);
let queueAborted = false;
let activeFuncCodes: string[] = [];
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
  connecting,
  connectedDevices,
  connect,
  disconnectDevice,
  disconnectAll,
  sendToDevice,
  sendFunctionStrengthToDevice,
  sendFunctionStrength,
} = useBluetooth();
watch(connectedDevices, (devs) => {
  if (devs.length > 0 && !debugDeviceId.value) {
    debugDeviceId.value = devs[0].id;
  }
  if (devs.length > 0 && !devs.find(d => d.id === debugDeviceId.value)) {
    debugDeviceId.value = devs[0].id;
  }
});

function getDeviceFunctions(dev: ConnectedDevice): FunctionInfo[] {
  return dev.deviceInfo?.runtimeConf?.functions || [];
}

// ===== 滑块状态管理（per-device） =====
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

const deviceSliderStates = ref<Map<string, SliderState[]>>(new Map());
const controlZoneRefs = new Map<string, HTMLElement>();
const SLIDER_SIZE = 40;
const SLIDER_GAP = 12;
const ZONE_HEIGHT = 120;

function setControlZoneRef(deviceId: string, el: HTMLElement | null) {
  if (el) {
    controlZoneRefs.set(deviceId, el);
  } else {
    controlZoneRefs.delete(deviceId);
  }
}

function getSliderState(deviceId: string, fIdx: number): SliderState | undefined {
  return deviceSliderStates.value.get(deviceId)?.[fIdx];
}

function getCenteredPositions(count: number, zoneWidth = 270): Array<{ x: number; y: number }> {
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
  connectedDevices,
  (devs) => {
    nextTick(() => {
      const newMap = new Map(deviceSliderStates.value);
      for (const dev of devs) {
        const funcs = getDeviceFunctions(dev);
        const existing = newMap.get(dev.id);
        if (!existing || existing.length !== funcs.length) {
          const zone = controlZoneRefs.get(dev.id);
          const zoneWidth = zone?.clientWidth || 270;
          const positions = getCenteredPositions(funcs.length, zoneWidth);
          newMap.set(dev.id, funcs.map((_: FunctionInfo, i: number) => ({
            ...positions[i],
            fixedX: 0, fixedY: 0,
            isOutside: false, isPinned: false,
            strength: 0, isDragging: false,
            isPaused: false, pausedStrength: 0,
          })));
        }
      }
      const activeIds = new Set(devs.map(d => d.id));
      for (const key of newMap.keys()) {
        if (!activeIds.has(key)) newMap.delete(key);
      }
      deviceSliderStates.value = newMap;
    });
  },
  { immediate: true, deep: true },
);

const BATTERY_RING_CIRCUMFERENCE = 2 * Math.PI * 16;

function getBatteryColor(level: number | null): string {
  if (level === null) return '#909399';
  if (level <= 20) return '#f56c6c';
  if (level <= 50) return '#e6a23c';
  return '#67c23a';
}

function getBatteryDashArray(level: number | null): string {
  const pct = (level ?? 0) / 100;
  const filled = pct * BATTERY_RING_CIRCUMFERENCE;
  return `${filled} ${BATTERY_RING_CIRCUMFERENCE - filled}`;
}

function getSliderStyle(deviceId: string, index: number): Record<string, string> {
  const state = deviceSliderStates.value.get(deviceId)?.[index];
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
  return { transform: `translate(${state.x}px, ${state.y}px)` };
}

const cachedMaxDistances = new Map<string, number>();

function getParentViewport(): { width: number; height: number } {
  try {
    const p = window.parent || window.top;
    if (p && p !== window) return { width: p.innerWidth, height: p.innerHeight };
  } catch { /* cross-origin */ }
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

function updateMaxDistance(deviceId: string) {
  const zone = controlZoneRefs.get(deviceId);
  if (!zone) return;
  const zoneRect = zone.getBoundingClientRect();
  const { width: pw, height: ph } = getParentViewport();
  const cx = zoneRect.left + zoneRect.width / 2;
  const cy = zoneRect.top + zoneRect.height / 2;
  const corners: [number, number][] = [[0, 0], [pw, 0], [0, ph], [pw, ph]];
  const maxDist = Math.max(...corners.map(([x, y]) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)));
  cachedMaxDistances.set(deviceId, maxDist);
}

function calculateStrength(
  sliderX: number, sliderY: number,
  zoneRect: DOMRect, func: FunctionInfo,
  deviceId: string,
): { isOutside: boolean; strength: number } {
  const distX = Math.max(0, -sliderX, sliderX + SLIDER_SIZE - zoneRect.width);
  const distY = Math.max(0, -sliderY, sliderY + SLIDER_SIZE - zoneRect.height);
  const isOutside = distX > 0 || distY > 0;
  if (!isOutside) return { isOutside: false, strength: 0 };

  const sliderCenterX = zoneRect.left + sliderX + SLIDER_SIZE / 2;
  const sliderCenterY = zoneRect.top + sliderY + SLIDER_SIZE / 2;
  const zoneCenterX = zoneRect.left + zoneRect.width / 2;
  const zoneCenterY = zoneRect.top + zoneRect.height / 2;
  const distanceToCenter = Math.sqrt((sliderCenterX - zoneCenterX) ** 2 + (sliderCenterY - zoneCenterY) ** 2);
  const zoneRadius = Math.sqrt((zoneRect.width / 2) ** 2 + (zoneRect.height / 2) ** 2);
  const overflow = Math.max(0, distanceToCenter - zoneRadius);
  const maxOverflow = Math.max(0, (cachedMaxDistances.get(deviceId) || 500) - zoneRadius);
  const ratio = Math.min(overflow / (maxOverflow || 1), 1);
  const strength = Math.round(func.minStrength + ratio * (func.maxStrength - func.minStrength));
  return { isOutside, strength };
}

const throttledSendStrength = throttle((deviceId: string, funcCode: string, strength: number) => {
  sendFunctionStrengthToDevice(deviceId, funcCode, strength);
}, 100);

const DRAG_THRESHOLD = 5;
const DBLCLICK_INTERVAL = 300;
const lastClickTimes: Map<string, number[]> = new Map();

function resetSingleSlider(deviceId: string, index: number) {
  const states = deviceSliderStates.value.get(deviceId);
  const dev = connectedDevices.value.find(d => d.id === deviceId);
  if (!states || !dev) return;
  const funcs = getDeviceFunctions(dev);
  const state = states[index];
  const func = funcs[index];
  if (!state || !func) return;

  const zone = controlZoneRefs.get(deviceId);
  const positions = getCenteredPositions(funcs.length, zone?.clientWidth || 270);
  Object.assign(state, {
    x: positions[index].x, y: positions[index].y,
    fixedX: 0, fixedY: 0,
    isOutside: false, isPinned: false,
    strength: 0, isPaused: false, pausedStrength: 0,
  });
  sendFunctionStrengthToDevice(deviceId, func.funcCode, 0);
  toastr.info(`已复位 ${func.funcDesc || func.funcCode}`);
}

function toggleSliderPause(deviceId: string, index: number) {
  const states = deviceSliderStates.value.get(deviceId);
  const dev = connectedDevices.value.find(d => d.id === deviceId);
  if (!states || !dev) return;
  const state = states[index];
  const func = getDeviceFunctions(dev)[index];
  if (!state || !func || !state.isPinned) return;

  if (state.isPaused) {
    state.isPaused = false;
    sendFunctionStrengthToDevice(deviceId, func.funcCode, state.pausedStrength);
    state.strength = state.pausedStrength;
  } else {
    state.isPaused = true;
    state.pausedStrength = state.strength;
    sendFunctionStrengthToDevice(deviceId, func.funcCode, 0);
  }
}

function handleSliderPointerDown(event: PointerEvent, deviceId: string, index: number) {
  event.preventDefault();
  const states = deviceSliderStates.value.get(deviceId);
  const zone = controlZoneRefs.get(deviceId);
  const dev = connectedDevices.value.find(d => d.id === deviceId);
  if (!states || !zone || !dev) return;
  const state = states[index];
  if (!state) return;

  updateMaxDistance(deviceId);
  const zoneRect = zone.getBoundingClientRect();
  const funcs = getDeviceFunctions(dev);
  const func = funcs[index];

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
      if (state.isPaused) state.isPaused = false;
    }
    const newFixedX = e.clientX - offsetX;
    const newFixedY = e.clientY - offsetY;
    state.fixedX = newFixedX;
    state.fixedY = newFixedY;
    const relX = newFixedX - zoneRect.left;
    const relY = newFixedY - zoneRect.top;
    state.x = relX;
    state.y = relY;
    const { isOutside, strength } = calculateStrength(relX, relY, zoneRect, func, deviceId);
    state.isOutside = isOutside;
    state.strength = strength;
    throttledSendStrength(deviceId, func.funcCode, strength);
  };

  const handlePointerUp = () => {
    state.isDragging = false;
    target.releasePointerCapture(event.pointerId);
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerup', handlePointerUp);
    target.removeEventListener('lostpointercapture', handlePointerUp);

    if (!hasMoved && state.isPinned) {
      const key = `${deviceId}_${index}`;
      if (!lastClickTimes.has(key)) lastClickTimes.set(key, []);
      const times = lastClickTimes.get(key)!;
      const now = Date.now();
      const lastClick = times[0] || 0;
      if (now - lastClick < DBLCLICK_INTERVAL) {
        times.length = 0;
        resetSingleSlider(deviceId, index);
        return;
      }
      times[0] = now;
      toggleSliderPause(deviceId, index);
      return;
    }
    state.isPinned = state.isOutside;
  };

  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerup', handlePointerUp);
  target.addEventListener('lostpointercapture', handlePointerUp);
}

function recalcOutsideSliders() {
  for (const [deviceId, states] of deviceSliderStates.value) {
    const zone = controlZoneRefs.get(deviceId);
    if (!zone) continue;
    const zoneRect = zone.getBoundingClientRect();
    const dev = connectedDevices.value.find(d => d.id === deviceId);
    if (!dev) continue;
    const funcs = getDeviceFunctions(dev);

    states.forEach((state, idx) => {
      if (!state.isPinned || state.isDragging) return;
      const relX = state.fixedX - zoneRect.left;
      const relY = state.fixedY - zoneRect.top;
      state.x = relX;
      state.y = relY;
      if (state.isPaused) return;
      const func = funcs[idx];
      if (!func) return;
      const { isOutside, strength } = calculateStrength(relX, relY, zoneRect, func, deviceId);
      state.isOutside = isOutside;
      state.strength = strength;
      throttledSendStrength(deviceId, func.funcCode, strength);
    });
  }
}

let lastZonePositions = new Map<string, { left: number; top: number }>();
let lastWindowWidth = -1;
let lastWindowHeight = -1;

const { pause: pauseZonePolling, resume: resumeZonePolling } = useRafFn(
  () => {
    const vp = getParentViewport();
    let changed = vp.width !== lastWindowWidth || vp.height !== lastWindowHeight;
    lastWindowWidth = vp.width;
    lastWindowHeight = vp.height;

    for (const [deviceId] of deviceSliderStates.value) {
      const zone = controlZoneRefs.get(deviceId);
      if (!zone) continue;
      const rect = zone.getBoundingClientRect();
      const prev = lastZonePositions.get(deviceId);
      if (!prev || rect.left !== prev.left || rect.top !== prev.top) {
        lastZonePositions.set(deviceId, { left: rect.left, top: rect.top });
        changed = true;
      }
    }

    if (changed) {
      for (const deviceId of deviceSliderStates.value.keys()) {
        updateMaxDistance(deviceId);
      }
      recalcOutsideSliders();
    }
  },
  { immediate: false },
);

watch(
  () => {
    for (const states of deviceSliderStates.value.values()) {
      if (states.some(s => s.isPinned && !s.isDragging)) return true;
    }
    return false;
  },
  (hasPinned) => {
    if (hasPinned) {
      lastZonePositions = new Map();
      lastWindowWidth = -1;
      lastWindowHeight = -1;
      resumeZonePolling();
    } else {
      pauseZonePolling();
    }
  },
);

function isDeviceAllPaused(deviceId: string): boolean {
  const states = deviceSliderStates.value.get(deviceId);
  if (!states) return false;
  const pinned = states.filter(s => s.isPinned);
  return pinned.length > 0 && pinned.every(s => s.isPaused);
}

function handlePauseDevice(deviceId: string) {
  const states = deviceSliderStates.value.get(deviceId);
  const dev = connectedDevices.value.find(d => d.id === deviceId);
  if (!states || !dev) return;
  const funcs = getDeviceFunctions(dev);
  const shouldResume = isDeviceAllPaused(deviceId);

  if (shouldResume) {
    states.forEach((state, idx) => {
      if (!state.isPinned) return;
      const func = funcs[idx];
      if (!func) return;
      state.isPaused = false;
      sendFunctionStrengthToDevice(deviceId, func.funcCode, state.pausedStrength);
      state.strength = state.pausedStrength;
    });
    return;
  }

  if (queueRunning.value) queueAborted = true;

  const sentCodes = new Set<string>();
  states.forEach((state, idx) => {
    if (!state.isPinned) return;
    const func = funcs[idx];
    if (!func) return;
    state.isPaused = true;
    state.pausedStrength = state.strength;
    sendFunctionStrengthToDevice(deviceId, func.funcCode, 0);
    sentCodes.add(func.funcCode);
  });
  for (const func of funcs) {
    if (!sentCodes.has(func.funcCode)) {
      sendFunctionStrengthToDevice(deviceId, func.funcCode, 0);
    }
  }
}

function handleResetDevice(deviceId: string) {
  const states = deviceSliderStates.value.get(deviceId);
  const dev = connectedDevices.value.find(d => d.id === deviceId);
  if (!states || !dev) return;
  const funcs = getDeviceFunctions(dev);
  const zone = controlZoneRefs.get(deviceId);
  const positions = getCenteredPositions(funcs.length, zone?.clientWidth || 270);
  funcs.forEach((func, idx) => {
    const state = states[idx];
    if (!state) return;
    Object.assign(state, {
      x: positions[idx].x, y: positions[idx].y,
      fixedX: 0, fixedY: 0,
      isOutside: false, isPinned: false,
      strength: 0, isPaused: false, pausedStrength: 0,
    });
    sendFunctionStrengthToDevice(deviceId, func.funcCode, 0);
  });
  toastr.info('已复位所有滑块');
}

function handleConnect() {
  connect();
}

function handleDisconnectOne(deviceId: string) {
  disconnectDevice(deviceId);
  toastr.info('已断开设备连接');
}

function handleDisconnectAll() {
  disconnectAll();
  toastr.info('已断开所有蓝牙连接');
}

async function handleSendCommand() {
  const cmd = commandInput.value.trim();
  if (!cmd || !debugDeviceId.value) {
    toastr.warning('请输入指令并选择设备');
    return;
  }
  try {
    await sendToDevice(debugDeviceId.value, cmd);
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

async function handleExecuteQueue() {
  const input = queueInput.value.trim();
  if (!input) return;

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
  const cycleTime = cumulativeTime > 0 ? cumulativeTime : 1;

  const queue: QueueItem[] = [];
  for (const cmd of commands) {
    for (const fu of cmd.funcUnits) {
      queue.push({ time: cmd.time, funcCode: fu.funcCode, strength: fu.strength });
    }
  }
  queue.sort((a, b) => a.time - b.time);

  queueAborted = false;
  queueRunning.value = true;
  const funcCodes: string[] = [...new Set(queue.map((item: QueueItem) => item.funcCode))];
  activeFuncCodes = funcCodes;
  const startedAt = Date.now();

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

  try {
    const executeOnce = async () => {
      let currentTime = 0;
      for (const item of queue) {
        if (queueAborted) return;
        if (item.time > currentTime) {
          await cappedWait(item.time - currentTime);
          currentTime = item.time;
        }
        if (queueAborted || checkExpired()) return;
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
    for (const fc of activeFuncCodes) {
      try { await sendFunctionStrength(fc, 0); } catch { /* noop */ }
    }
    activeFuncCodes = [];
    queueRunning.value = false;
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

.device-card {
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  padding-bottom: 4px;
  margin-bottom: 4px;
}

.device-card:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
}

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
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

.device-disconnect-btn {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.5;
  transition: opacity 0.2s;
}

.device-disconnect-btn:hover {
  opacity: 1;
}

.product-avatar-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  cursor: pointer;
}

.battery-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.battery-ring__track {
  fill: none;
  stroke: var(--SmartThemeBorderColor);
  stroke-width: 2.5;
  opacity: 0.3;
}

.battery-ring__fill {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  transition: stroke-dasharray 0.6s ease, stroke 0.3s ease;
}

.product-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
  position: relative;
  z-index: 1;
}

.product-avatar-placeholder {
  font-size: 14px;
  color: var(--SmartThemeBodyColor);
  opacity: 0.6;
  position: relative;
  z-index: 1;
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

.debug-device-select {
  width: 100px;
  font-size: 12px;
  padding: 6px 8px;
  flex-shrink: 0;
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
