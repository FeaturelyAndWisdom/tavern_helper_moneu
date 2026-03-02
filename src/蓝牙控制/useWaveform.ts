import { ref } from 'vue';

export interface CommandPoint {
  funcCode: string;
  time: number;
  strength: number;
}

export interface WaveformData {
  globalTime: number;
  commands: CommandPoint[];
}

// 波形数据状态（全局单例）
const waveformData = ref<WaveformData | null>(null);
const waveformCurrentTime = ref(0);
const waveformActive = ref(false);

export function useWaveform() {
  return {
    waveformData,
    waveformCurrentTime,
    waveformActive,
  };
}
