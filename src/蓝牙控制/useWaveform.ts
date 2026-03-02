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

const waveformData = ref<WaveformData | null>(null);
const waveformCurrentTime = ref(0);
const waveformActive = ref(false);
const lastCommandRaw = ref<string | null>(null);

type StopExecutionCallback = () => void;
let stopExecutionCallback: StopExecutionCallback | null = null;

export function useWaveform() {
  return {
    waveformData,
    waveformCurrentTime,
    waveformActive,
    lastCommandRaw,
    registerStopExecution(cb: StopExecutionCallback) {
      stopExecutionCallback = cb;
    },
    requestStopExecution() {
      stopExecutionCallback?.();
    },
  };
}
