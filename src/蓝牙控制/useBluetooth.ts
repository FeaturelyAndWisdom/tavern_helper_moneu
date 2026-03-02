import { onMounted, ref } from 'vue';

const STORAGE_KEY = 'bluetooth_device_id';
const NOTIFY_TIMEOUT = 5000;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 3;
// const API_BASE_URL = 'https://moneu-test.moneu.cn';
// local
const API_BASE_URL = 'http://localhost:8086';

// 功能点信息类型
export interface FunctionInfo {
  funcCode: string;
  funcDesc: string;
  funcIconUrl?: string;
  maxStrength: number;
  minStrength: number;
}

// 设备运行信息类型
export interface RuntimeConf {
  functions: FunctionInfo[];
}

// 设备信息类型
export interface DeviceInfo {
  bgUrl: string;
  deviceName: string;
  deviceNo: string;
  productNo: string;
  runtimeConf?: RuntimeConf;
}

// 共享状态（单例模式）
const isConnected = ref(false);
const connecting = ref(false);
const deviceName = ref('');
const deviceIcon = ref('');
const batteryLevel = ref<number | null>(null);
const deviceInfo = ref<DeviceInfo | null>(null);
const deviceScenario = ref('必定生成');

const bluetoothDevice = ref<BluetoothDevice | null>(null);
const bluetoothWriteCharacteristic = ref<BluetoothRemoteGATTCharacteristic | null>(null);
const bluetoothReadCharacteristic = ref<BluetoothRemoteGATTCharacteristic | null>(null);

// 指令序列相关
const commandTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const currentCmdIndex = ref(0);
const currentCmds = ref<Array<{ cmd: string; strength?: number; time: number }>>([]);

// 通过酒馆后端代理请求外部 API，避免 CORS 问题
// 需在 SillyTavern 的 config.yaml 中启用 enableCorsProxy: true
async function proxyFetch(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(`/proxy/${url}`, {
    method: options?.method || 'GET',
    headers: {
      ...SillyTavern.getRequestHeaders(),
      ...(options?.headers || {}),
    },
    body: options?.body,
  });
  if (!response.ok) {
    throw new Error(`Proxy fetch failed: ${response.status}`);
  }
  return response;
}

// API 调用获取设备信息
async function getDeviceFromBlueToothApi(params: {
  blueToothName: string;
}): Promise<{ data?: { device?: DeviceInfo } }> {
  try {
    const targetUrl = `${API_BASE_URL}/moneu/api/resource/deviceFromBlueTooth?source=st`;
    const response = await proxyFetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        blueToothName: params.blueToothName,
      }),
    });
    return await response.json();
  } catch (error) {
    console.error('[Bluetooth] 获取设备信息 API 调用失败:', error);
    throw error;
  }
}

let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let isReconnecting = false;
let manualDisconnect = false;

const serviceUuid = '0000ffe0-0000-1000-8000-00805f9b34fb';
const writeCharacteristicUuid = '0000ffe1-0000-1000-8000-00805f9b34fb';
const readCharacteristicUuid = '0000ffe2-0000-1000-8000-00805f9b34fb';

// 辅助函数
const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
};

const hexToBytes = (hex: string): Uint8Array => {
  hex = hex.replace(/\s/g, '');
  if (hex.length % 2 !== 0) throw new Error('无效的十六进制字符串');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

const makeCheckSum = (data: string): string => {
  try {
    let dSum = 0;
    const cleanData = data.replace(/\s/g, '');
    const length = cleanData.length;
    let index = 0;
    while (index < length) {
      const s = cleanData.substring(index, index + 2);
      dSum += parseInt(s, 16);
      index += 2;
    }
    const mod = dSum % 256;
    let checkSumHex = mod.toString(16).toUpperCase();
    if (checkSumHex.length < 2) checkSumHex = '0' + checkSumHex;
    return checkSumHex;
  } catch (error) {
    console.error('计算校验和失败:', error);
    return '00';
  }
};

const clearTimers = (): void => {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const handleNotifyEvent = (event: Event): void => {
  const target = event.target as BluetoothRemoteGATTCharacteristic;
  const value = target.value;
  if (!value) return;

  const data = new Uint8Array(value.buffer);
  const hex = bytesToHex(data);
  if (hex.length >= 2) {
    const batteryHex = hex.split(' ')[0];
    batteryLevel.value = parseInt(batteryHex, 16);
  }
  resetNotifyTimer();
};

const resetNotifyTimer = (): void => {
  clearTimers();
  notifyTimer = setTimeout(() => {
    console.warn('[Bluetooth] 5s 内未收到设备上报，尝试重连');
    if (!manualDisconnect) attemptReconnect();
  }, NOTIFY_TIMEOUT);
};

const handleDisconnectEvent = (): void => {
  console.log('[Bluetooth] 设备已断开连接');
  isConnected.value = false;
  batteryLevel.value = null;
  bluetoothWriteCharacteristic.value = null;
  bluetoothReadCharacteristic.value = null;
  clearTimers();
  if (!manualDisconnect) attemptReconnect();
};

const connectToDevice = async (device: BluetoothDevice): Promise<boolean> => {
  try {
    deviceName.value = device.name || '未知设备';
    bluetoothDevice.value = device;
    device.removeEventListener('gattserverdisconnected', handleDisconnectEvent);
    device.addEventListener('gattserverdisconnected', handleDisconnectEvent);

    console.log('[Bluetooth] 正在连接 GATT 服务器...');
    const server = await device.gatt?.connect();
    if (!server) throw new Error('无法连接到 GATT 服务器');

    console.log('[Bluetooth] 正在获取服务...');
    const service = await server.getPrimaryService(serviceUuid);

    console.log('[Bluetooth] 正在获取特征值...');
    const readChar = await service?.getCharacteristic(readCharacteristicUuid);
    bluetoothReadCharacteristic.value = readChar || null;

    const writeChar = await service?.getCharacteristic(writeCharacteristicUuid);
    bluetoothWriteCharacteristic.value = writeChar || null;

    if (readChar) {
      console.log('[Bluetooth] 正在启动通知...');
      await readChar.startNotifications();
      readChar.addEventListener('characteristicvaluechanged', handleNotifyEvent);
      try {
        const value = await readChar.readValue();
        handleNotifyEvent({ target: { value } } as unknown as Event);
      } catch (e) {
        console.warn('[Bluetooth] 读取初始电量失败', e);
      }
    }

    isConnected.value = true;
    reconnectAttempts = 0;
    isReconnecting = false;
    resetNotifyTimer();

    // 获取产品信息
    if (deviceName.value) {
      try {
        const res = await getDeviceFromBlueToothApi({ blueToothName: deviceName.value });
        const deviceData = res.data?.device;
        if (deviceData) {
          deviceIcon.value = deviceData.bgUrl || '';
          deviceInfo.value = {
            bgUrl: deviceData.bgUrl || '',
            deviceName: deviceData.deviceName || deviceName.value,
            deviceNo: deviceData.deviceNo,
            productNo: deviceData.productNo,
            runtimeConf: deviceData.runtimeConf,
          };
          console.log('[Bluetooth] 获取产品信息成功:', deviceInfo.value);
        }
      } catch (e) {
        console.error('[Bluetooth] 获取设备资源失败', e);
      }
    }

    try {
      localStorage.setItem(STORAGE_KEY, device.id);
    } catch {
      console.warn('[Bluetooth] 无法保存设备 ID 到 localStorage');
    }

    return true;
  } catch (error) {
    console.error('[Bluetooth] 连接设备失败:', error);
    isConnected.value = false;
    throw error;
  }
};

const attemptReconnect = (): void => {
  if (isReconnecting || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[Bluetooth] 重连失败，已达到最大重试次数 ${MAX_RECONNECT_ATTEMPTS}`);
      toastr.warning('设备连接已断开，请手动重新连接');
      reconnectAttempts = 0;
    }
    return;
  }
  isReconnecting = true;
  reconnectAttempts++;
  reconnectTimer = setTimeout(async () => {
    try {
      if (bluetoothDevice.value?.gatt) {
        connecting.value = true;
        if (!bluetoothDevice.value.gatt.connected) {
          await connectToDevice(bluetoothDevice.value);
        } else {
          isConnected.value = true;
          reconnectAttempts = 0;
          isReconnecting = false;
          resetNotifyTimer();
        }
      }
    } catch (error) {
      isReconnecting = false;
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) attemptReconnect();
    } finally {
      connecting.value = false;
    }
  }, RECONNECT_DELAY);
};

const disconnect = (): void => {
  manualDisconnect = true;
  stopCommandSequence();
  clearTimers();
  reconnectAttempts = 0;
  isReconnecting = false;
  if (bluetoothDevice.value?.gatt?.connected) {
    bluetoothDevice.value.gatt.disconnect();
  }
  isConnected.value = false;
  batteryLevel.value = null;
  bluetoothWriteCharacteristic.value = null;
  bluetoothReadCharacteristic.value = null;
  deviceName.value = '';
  deviceIcon.value = '';
  deviceInfo.value = null;
  try {
    localStorage.setItem(STORAGE_KEY, '');
  } catch {
    console.warn('[Bluetooth] 无法清除 localStorage 中的设备 ID');
  }
};

// 指令序列管理
function stopCommandSequence(): void {
  console.log('[Bluetooth] 停止指令序列');
  if (commandTimer.value) {
    clearTimeout(commandTimer.value);
    commandTimer.value = null;
  }
  currentCmds.value = [];
}

function startCommandSequence(cmds: Array<{ cmd: string; strength?: number; time: number }>): void {
  if (!cmds || cmds.length === 0) {
    console.warn('[Bluetooth] 尝试启动空指令序列，正在停止当前序列');
    stopCommandSequence();
    return;
  }

  if (commandTimer.value && JSON.stringify(cmds) === JSON.stringify(currentCmds.value)) {
    console.log('[Bluetooth] 指令序列一致且正在运行，跳过重置');
    return;
  }

  console.log(`[Bluetooth] 启动新指令序列, 指令数: ${cmds.length}`);
  stopCommandSequence();

  currentCmds.value = [...cmds];
  currentCmdIndex.value = 0;

  const runNext = (): void => {
    if (!isConnected.value) {
      console.warn('[Bluetooth] 设备未连接，停止指令序列');
      stopCommandSequence();
      return;
    }

    if (currentCmds.value.length === 0) {
      console.log('[Bluetooth] 指令序列为空，正常退出');
      stopCommandSequence();
      return;
    }

    const item = currentCmds.value[currentCmdIndex.value];
    if (!item) {
      console.warn(`[Bluetooth] 找不到索引为 ${currentCmdIndex.value} 的指令，停止序列`);
      stopCommandSequence();
      return;
    }

    console.log(
      `[Bluetooth] 正在执行序列指令 (索引 ${currentCmdIndex.value}/${currentCmds.value.length}): ${item.cmd}, 强度: ${item.strength}, 预期时长: ${item.time}ms`,
    );

    sendInternal(item.cmd).catch(err => {
      console.error('[Bluetooth] 指令执行失败:', err);
    });

    currentCmdIndex.value = (currentCmdIndex.value + 1) % currentCmds.value.length;

    if (currentCmds.value.length === 1 && item.time === 0) {
      commandTimer.value = null;
      return;
    }

    commandTimer.value = setTimeout(runNext, item.time || 0);
  };

  runNext();
}

async function sendInternal(cmdText: string, appendChecksum = true): Promise<boolean> {
  if (!isConnected.value || !bluetoothDevice.value) {
    throw new Error('设备未连接');
  }

  try {
    let finalCmdText = cmdText.replace(/\s/g, '');
    if (appendChecksum) {
      const checksum = makeCheckSum(cmdText);
      finalCmdText += checksum;
    }

    const data = hexToBytes(finalCmdText);

    let char = bluetoothWriteCharacteristic.value;
    if (!char && bluetoothDevice.value.gatt) {
      console.log('[Bluetooth] 重新获取写特征值...');
      const server = await bluetoothDevice.value.gatt.connect();
      const service = await server.getPrimaryService(serviceUuid);
      char = await service.getCharacteristic(writeCharacteristicUuid);
      bluetoothWriteCharacteristic.value = char;
    }

    if (!char) {
      throw new Error('无法获取写特征值');
    }

    await char.writeValue(data);
    return true;
  } catch (error) {
    console.error('[Bluetooth] 发送指令失败:', error);
    throw error;
  }
}

// 根据功能点和强度组装并发送单指令
async function sendFunctionStrength(funcCode: string, strength: number): Promise<boolean> {
  if (!isConnected.value || !deviceInfo.value?.runtimeConf?.functions) {
    console.warn('[Bluetooth] 设备未连接或没有功能点信息');
    return false;
  }

  const funcInfo = deviceInfo.value.runtimeConf.functions.find(f => f.funcCode === funcCode);
  if (!funcInfo) {
    console.warn(`[Bluetooth] 找不到功能点: ${funcCode}`);
    return false;
  }

  const rounded = Math.round(strength);
  const clampedStrength = rounded === 0 ? 0 : Math.max(funcInfo.minStrength, Math.min(funcInfo.maxStrength, rounded));
  const strengthHex = clampedStrength.toString(16).padStart(2, '0').toUpperCase();
  const funcCodeHex = funcCode.padStart(2, '0').toUpperCase();
  const deviceNo = deviceInfo.value.deviceNo;

  // 组装指令: deviceNo + funcCode + 强度16进制 + 00
  const cmd = `${deviceNo} ${funcCodeHex} ${strengthHex} 00`;

  try {
    await sendInternal(cmd);
    return true;
  } catch (error) {
    console.error('[Bluetooth] 发送功能点指令失败:', error);
    return false;
  }
}

// Hook 定义
export function useBluetooth() {
  const connect = async (): Promise<void> => {
    if (!('bluetooth' in navigator)) {
      toastr.error('当前浏览器不支持 Web Bluetooth API');
      return;
    }
    connecting.value = true;
    manualDisconnect = false;
    try {
      const device = await (navigator as Navigator & { bluetooth: Bluetooth }).bluetooth.requestDevice({
        filters: [{ namePrefix: 'MY' }],
        optionalServices: [serviceUuid],
      });
      await connectToDevice(device);
      toastr.success('蓝牙连接成功');
    } catch (error) {
      if ((error as Error).name !== 'NotFoundError') {
        toastr.error(`连接失败: ${(error as Error).message}`);
      }
    } finally {
      connecting.value = false;
    }
  };

  const autoReconnect = async (): Promise<void> => {
    let deviceId: string | null = null;
    try {
      deviceId = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }

    if (!deviceId || isConnected.value || connecting.value) return;

    const nav = navigator as Navigator & { bluetooth?: Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> } };
    if (!nav.bluetooth?.getDevices) return;

    try {
      connecting.value = true;
      manualDisconnect = false;
      const devices = await nav.bluetooth.getDevices();
      const cachedDevice = devices.find(d => d.id === deviceId);
      if (cachedDevice) {
        await connectToDevice(cachedDevice);
      }
    } catch (error) {
      console.error('[Bluetooth] 自动重连失败:', error);
    } finally {
      connecting.value = false;
    }
  };

  const send = async (cmdText: string, appendChecksum = true): Promise<boolean> => {
    return await sendInternal(cmdText, appendChecksum);
  };

  onMounted(() => {
    if (!isConnected.value && !connecting.value) {
      autoReconnect();
    }
  });

  return {
    isConnected,
    connecting,
    deviceName,
    deviceIcon,
    batteryLevel,
    deviceInfo,
    deviceScenario,
    connect,
    disconnect,
    send,
    sendFunctionStrength,
    startCommandSequence,
    stopCommandSequence,
  };
}
