<template>
  <div v-if="isActive" class="waveform-chart">
    <div class="waveform-chart__header">
      <span class="waveform-chart__title">指令波形</span>
      <span class="waveform-chart__time">{{ formatTime(currentTime) }} / {{ formatTime(globalTime) }}</span>
    </div>
    <div ref="chartContainer" class="waveform-chart__canvas-container">
      <canvas ref="canvasRef" class="waveform-chart__canvas"></canvas>
    </div>
    <div class="waveform-chart__legend">
      <div v-for="(color, funcCode) in funcColors" :key="funcCode" class="waveform-chart__legend-item">
        <span class="waveform-chart__legend-color" :style="{ backgroundColor: color }"></span>
        <span class="waveform-chart__legend-label">{{ funcCode }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core';
import type { WaveformData, CommandPoint } from './useWaveform';

const props = defineProps<{
  waveformData: WaveformData | null;
  currentTime: number;
  isActive: boolean;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const chartContainer = ref<HTMLElement | null>(null);

const rawGlobalTime = computed(() => props.waveformData?.globalTime ?? 0);
const commands = computed(() => props.waveformData?.commands ?? []);
const globalTime = computed(() => {
  if (rawGlobalTime.value > 0) return rawGlobalTime.value;
  const maxTime = commands.value.reduce((m, c) => Math.max(m, c.time), 0);
  return maxTime > 0 ? maxTime : 1;
});

// 生成随机颜色
function generateColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// 获取所有功能单元的颜色映射
const funcColors = computed(() => {
  const colors: Record<string, string> = {};
  const funcCodes = new Set(commands.value.map(c => c.funcCode));
  funcCodes.forEach(code => {
    colors[code] = generateColor(code);
  });
  return colors;
});

// 获取最大强度
const maxStrength = computed(() => {
  if (commands.value.length === 0) return 100;
  return Math.max(...commands.value.map(c => c.strength), 100);
});

// 格式化时间
function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// 绘制图表
function drawChart() {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 10, right: 10, bottom: 20, left: 30 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 清空画布
  ctx.clearRect(0, 0, width, height);

  // 绘制背景
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);

  // 绘制网格线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  
  // 横向网格线（强度）
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
  }

  // 纵向网格线（时间）
  const timeSteps = 5;
  for (let i = 0; i <= timeSteps; i++) {
    const x = padding.left + (chartWidth / timeSteps) * i;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
  }

  // 绘制Y轴标签（强度）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight / 4) * i;
    const value = Math.round(maxStrength.value * (1 - i / 4));
    ctx.fillText(String(value), padding.left - 4, y);
  }

  // 绘制X轴标签（时间）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i <= timeSteps; i++) {
    const x = padding.left + (chartWidth / timeSteps) * i;
    const time = (globalTime.value / timeSteps) * i;
    ctx.fillText(formatTime(time), x, padding.top + chartHeight + 4);
  }

  // 按功能单元分组绘制波形
  const groupedCommands: Record<string, CommandPoint[]> = {};
  commands.value.forEach(cmd => {
    if (!groupedCommands[cmd.funcCode]) {
      groupedCommands[cmd.funcCode] = [];
    }
    groupedCommands[cmd.funcCode].push(cmd);
  });

  // 绘制每个功能单元的波形
  Object.entries(groupedCommands).forEach(([funcCode, funcCommands]) => {
    const color = funcColors.value[funcCode];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    // 排序按时间
    const sortedCmds = [...funcCommands].sort((a, b) => a.time - b.time);
    
    // 从0点开始
    const startX = padding.left;
    const startY = padding.top + chartHeight; // 强度0在底部
    ctx.moveTo(startX, startY);

    sortedCmds.forEach((cmd, index) => {
      const x = padding.left + (cmd.time / globalTime.value) * chartWidth;
      const y = padding.top + chartHeight - (cmd.strength / maxStrength.value) * chartHeight;
      
      if (index === 0) {
        // 水平线到第一个点的时间位置
        ctx.lineTo(x, startY);
      }
      
      // 垂直跳变到当前强度
      ctx.lineTo(x, y);
      
      // 如果有下一个点，水平线到下一个点的时间
      if (index < sortedCmds.length - 1) {
        const nextX = padding.left + (sortedCmds[index + 1].time / globalTime.value) * chartWidth;
        ctx.lineTo(nextX, y);
      } else {
        // 最后一个点，延伸到末尾
        ctx.lineTo(padding.left + chartWidth, y);
      }
    });

    ctx.stroke();

    // 绘制数据点
    ctx.fillStyle = color;
    sortedCmds.forEach(cmd => {
      const x = padding.left + (cmd.time / globalTime.value) * chartWidth;
      const y = padding.top + chartHeight - (cmd.strength / maxStrength.value) * chartHeight;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // 绘制当前时间参考线
  if (props.currentTime >= 0 && props.currentTime <= globalTime.value) {
    const currentX = padding.left + (props.currentTime / globalTime.value) * chartWidth;
    
    // 发光效果
    ctx.shadowColor = '#ff6b6b';
    ctx.shadowBlur = 8;
    
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, padding.top + chartHeight);
    ctx.stroke();
    
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // 顶部时间标签
    ctx.fillStyle = '#ff6b6b';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(formatTime(props.currentTime), currentX, padding.top - 2);
  }
}

// 监听数据变化重绘
watch([() => props.waveformData, () => props.currentTime, () => props.isActive], () => {
  if (props.isActive) {
    requestAnimationFrame(drawChart);
  }
}, { deep: true });

// 响应容器大小变化
useResizeObserver(chartContainer, () => {
  if (props.isActive) {
    requestAnimationFrame(drawChart);
  }
});

onMounted(() => {
  if (props.isActive) {
    requestAnimationFrame(drawChart);
  }
});
</script>

<style scoped>
.waveform-chart {
  margin-top: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  border: 1px solid var(--SmartThemeBorderColor);
}

.waveform-chart__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--SmartThemeBodyColor);
}

.waveform-chart__title {
  font-weight: 600;
  opacity: 0.8;
}

.waveform-chart__time {
  font-family: monospace;
  opacity: 0.7;
}

.waveform-chart__canvas-container {
  width: 100%;
  height: 100px;
}

.waveform-chart__canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.waveform-chart__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.waveform-chart__legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--SmartThemeBodyColor);
  opacity: 0.8;
}

.waveform-chart__legend-color {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.waveform-chart__legend-label {
  font-family: monospace;
}
</style>
