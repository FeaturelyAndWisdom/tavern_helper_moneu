import { computed, onMounted, ref } from 'vue';

const STORAGE_KEY = 'bluetooth_device_ids';
const NOTIFY_TIMEOUT = 5000;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 3;
const API_BASE_URL = 'https://moneu-test.moneu.cn';

export interface FunctionInfo {
  funcCode: string;
  funcDesc: string;
  funcIconUrl?: string;
  maxStrength: number;
  minStrength: number;
}

export interface RuntimeConf {
  functions: FunctionInfo[];
  deviceDesc: string;
}

export interface DeviceInfo {
  bgUrl: string;
  deviceName: string;
  deviceNo: string;
  productNo: string;
  runtimeConf?: RuntimeConf;
}

export interface ConnectedDevice {
  id: string;
  name: string;
  icon: string;
  batteryLevel: number | null;
  deviceInfo: DeviceInfo | null;
  bluetoothDevice: BluetoothDevice;
  writeCharacteristic: BluetoothRemoteGATTCharacteristic | null;
  readCharacteristic: BluetoothRemoteGATTCharacteristic | null;
  notifyTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  isReconnecting: boolean;
  manualDisconnect: boolean;
}

const devices = ref<Map<string, ConnectedDevice>>(new Map());
const connecting = ref(false);
const promptInjectionEnabled = ref(true);

const hasConnectedDevice = computed(() => devices.value.size > 0);
const connectedDevices = computed(() => [...devices.value.values()]);
const allDeviceInfos = computed(() =>
  connectedDevices.value.map(d => d.deviceInfo).filter((d): d is DeviceInfo => d !== null),
);

const serviceUuid = '0000ffe0-0000-1000-8000-00805f9b34fb';
const writeCharacteristicUuid = '0000ffe1-0000-1000-8000-00805f9b34fb';
const readCharacteristicUuid = '0000ffe2-0000-1000-8000-00805f9b34fb';

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

async function getDeviceFromBlueToothApi(params: {
  blueToothName: string;
}): Promise<{ data?: { device?: DeviceInfo } }> {
  try {
    const targetUrl = `${API_BASE_URL}/moneu/api/resource/deviceFromBlueTooth?source=st`;
    const response = await proxyFetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueToothName: params.blueToothName }),
    });
    return await response.json();
  } catch (error) {
    console.error('[Bluetooth] 获取设备信息 API 调用失败:', error);
    throw error;
  }
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');

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
    let index = 0;
    while (index < cleanData.length) {
      dSum += parseInt(cleanData.substring(index, index + 2), 16);
      index += 2;
    }
    let checkSumHex = (dSum % 256).toString(16).toUpperCase();
    if (checkSumHex.length < 2) checkSumHex = '0' + checkSumHex;
    return checkSumHex;
  } catch (error) {
    console.error('计算校验和失败:', error);
    return '00';
  }
};

function clearDeviceTimers(entry: ConnectedDevice): void {
  if (entry.notifyTimer) {
    clearTimeout(entry.notifyTimer);
    entry.notifyTimer = null;
  }
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
}

function makeNotifyHandler(deviceId: string) {
  return (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    if (!value) return;

    const data = new Uint8Array(value.buffer);
    const hex = bytesToHex(data);
    if (hex.length >= 2) {
      const batteryHex = hex.split(' ')[0];
      const entry = devices.value.get(deviceId);
      if (entry) {
        entry.batteryLevel = parseInt(batteryHex, 16);
        triggerReactivity();
      }
    }
    resetNotifyTimer(deviceId);
  };
}

function triggerReactivity(): void {
  devices.value = new Map(devices.value);
}

function resetNotifyTimer(deviceId: string): void {
  const entry = devices.value.get(deviceId);
  if (!entry) return;
  clearDeviceTimers(entry);
  entry.notifyTimer = setTimeout(() => {
    console.warn(`[Bluetooth] 设备 ${entry.name} 5s 内未收到上报，尝试重连`);
    if (!entry.manualDisconnect) attemptReconnect(deviceId);
  }, NOTIFY_TIMEOUT);
}

function makeDisconnectHandler(deviceId: string) {
  return () => {
    const entry = devices.value.get(deviceId);
    if (!entry) return;
    console.log(`[Bluetooth] 设备 ${entry.name} 已断开连接`);
    entry.batteryLevel = null;
    entry.writeCharacteristic = null;
    entry.readCharacteristic = null;
    clearDeviceTimers(entry);
    triggerReactivity();
    if (!entry.manualDisconnect) attemptReconnect(deviceId);
  };
}

const disconnectHandlers = new Map<string, () => void>();
const notifyHandlers = new Map<string, (event: Event) => void>();

async function connectToDevice(device: BluetoothDevice): Promise<ConnectedDevice> {
  const deviceId = device.id;
  const name = device.name || '未知设备';

  const existing = devices.value.get(deviceId);
  if (existing) {
    const oldDisconnectHandler = disconnectHandlers.get(deviceId);
    if (oldDisconnectHandler) {
      existing.bluetoothDevice.removeEventListener('gattserverdisconnected', oldDisconnectHandler);
    }
  }

  const disconnectHandler = makeDisconnectHandler(deviceId);
  disconnectHandlers.set(deviceId, disconnectHandler);
  device.addEventListener('gattserverdisconnected', disconnectHandler);

  console.log(`[Bluetooth] 正在连接 ${name} GATT 服务器...`);
  const server = await device.gatt?.connect();
  if (!server) throw new Error('无法连接到 GATT 服务器');

  const service = await server.getPrimaryService(serviceUuid);
  const readChar = await service?.getCharacteristic(readCharacteristicUuid);
  const writeChar = await service?.getCharacteristic(writeCharacteristicUuid);

  const notifyHandler = makeNotifyHandler(deviceId);
  notifyHandlers.set(deviceId, notifyHandler);

  if (readChar) {
    await readChar.startNotifications();
    readChar.addEventListener('characteristicvaluechanged', notifyHandler);
  }

  const entry: ConnectedDevice = {
    id: deviceId,
    name,
    icon: '',
    batteryLevel: null,
    deviceInfo: null,
    bluetoothDevice: device,
    writeCharacteristic: writeChar || null,
    readCharacteristic: readChar || null,
    notifyTimer: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    isReconnecting: false,
    manualDisconnect: false,
  };

  devices.value.set(deviceId, entry);
  triggerReactivity();
  resetNotifyTimer(deviceId);

  if (readChar) {
    try {
      const value = await readChar.readValue();
      notifyHandler({ target: { value } } as unknown as Event);
    } catch (e) {
      console.warn(`[Bluetooth] 读取 ${name} 初始电量失败`, e);
    }
  }

  if (name) {
    try {
      const res = await getDeviceFromBlueToothApi({ blueToothName: name });
      const deviceData = res.data?.device;
      if (deviceData) {
        entry.icon = deviceData.bgUrl || '';
        entry.deviceInfo = {
          bgUrl: deviceData.bgUrl || '',
          deviceName: deviceData.deviceName || name,
          deviceNo: deviceData.deviceNo,
          productNo: deviceData.productNo,
          runtimeConf: deviceData.runtimeConf,
        };
        console.log(`[Bluetooth] 获取 ${name} 产品信息成功:`, entry.deviceInfo);
        triggerReactivity();
      }
    } catch (e) {
      console.error(`[Bluetooth] 获取 ${name} 设备资源失败`, e);
    }
  }

  saveDeviceIds();
  return entry;
}

function attemptReconnect(deviceId: string): void {
  const entry = devices.value.get(deviceId);
  if (!entry) return;
  if (entry.isReconnecting || entry.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (entry.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[Bluetooth] ${entry.name} 重连失败，已达最大重试次数`);
      toastr.warning(`设备 ${entry.name} 连接已断开，请手动重新连接`);
      devices.value.delete(deviceId);
      triggerReactivity();
      saveDeviceIds();
    }
    return;
  }
  entry.isReconnecting = true;
  entry.reconnectAttempts++;
  entry.reconnectTimer = setTimeout(async () => {
    try {
      if (entry.bluetoothDevice.gatt) {
        connecting.value = true;
        if (!entry.bluetoothDevice.gatt.connected) {
          await connectToDevice(entry.bluetoothDevice);
        } else {
          entry.reconnectAttempts = 0;
          entry.isReconnecting = false;
          resetNotifyTimer(deviceId);
        }
      }
    } catch {
      entry.isReconnecting = false;
      if (entry.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) attemptReconnect(deviceId);
    } finally {
      connecting.value = false;
    }
  }, RECONNECT_DELAY);
}

function disconnectDevice(deviceId: string): void {
  const entry = devices.value.get(deviceId);
  if (!entry) return;

  entry.manualDisconnect = true;
  clearDeviceTimers(entry);
  entry.reconnectAttempts = 0;
  entry.isReconnecting = false;

  if (entry.bluetoothDevice.gatt?.connected) {
    entry.bluetoothDevice.gatt.disconnect();
  }

  devices.value.delete(deviceId);
  triggerReactivity();
  saveDeviceIds();
}

function disconnectAll(): void {
  for (const deviceId of [...devices.value.keys()]) {
    disconnectDevice(deviceId);
  }
}

function saveDeviceIds(): void {
  try {
    const ids = [...devices.value.keys()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    console.warn('[Bluetooth] 无法保存设备 ID 列表到 localStorage');
  }
}

async function sendToDevice(deviceId: string, cmdText: string, appendChecksum = true): Promise<boolean> {
  const entry = devices.value.get(deviceId);
  if (!entry) throw new Error(`设备 ${deviceId} 未连接`);

  let finalCmdText = cmdText.replace(/\s/g, '');
  if (appendChecksum) {
    finalCmdText += makeCheckSum(cmdText);
  }

  const data = hexToBytes(finalCmdText);
  let char = entry.writeCharacteristic;
  if (!char && entry.bluetoothDevice.gatt) {
    const server = await entry.bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(serviceUuid);
    char = await service.getCharacteristic(writeCharacteristicUuid);
    entry.writeCharacteristic = char;
  }
  if (!char) throw new Error('无法获取写特征值');

  await char.writeValue(data);
  return true;
}

async function sendFunctionStrengthToDevice(
  deviceId: string,
  funcCode: string,
  strength: number,
): Promise<boolean> {
  const entry = devices.value.get(deviceId);
  if (!entry?.deviceInfo?.runtimeConf?.functions) {
    console.warn(`[Bluetooth] 设备 ${deviceId} 未连接或没有功能点信息`);
    return false;
  }

  const funcInfo = entry.deviceInfo.runtimeConf.functions.find(f => f.funcCode === funcCode);
  if (!funcInfo) {
    console.warn(`[Bluetooth] 设备 ${deviceId} 找不到功能点: ${funcCode}`);
    return false;
  }

  const rounded = Math.round(strength);
  const clamped = rounded === 0 ? 0 : Math.max(funcInfo.minStrength, Math.min(funcInfo.maxStrength, rounded));
  const strengthHex = clamped.toString(16).padStart(2, '0').toUpperCase();
  const funcCodeHex = funcCode.padStart(2, '0').toUpperCase();
  const deviceNo = entry.deviceInfo.deviceNo;

  const cmd = `${deviceNo} ${funcCodeHex} ${strengthHex} 00`;
  try {
    await sendToDevice(deviceId, cmd);
    return true;
  } catch (error) {
    console.error(`[Bluetooth] 发送功能点指令失败 (设备 ${entry.name}):`, error);
    return false;
  }
}

function findDeviceByDeviceNo(deviceNo: string): ConnectedDevice | undefined {
  for (const entry of devices.value.values()) {
    if (entry.deviceInfo?.deviceNo === deviceNo) return entry;
  }
  return undefined;
}

async function sendFunctionStrengthByDeviceNo(
  deviceNo: string,
  funcCode: string,
  strength: number,
): Promise<boolean> {
  const entry = findDeviceByDeviceNo(deviceNo);
  if (!entry) {
    console.warn(`[Bluetooth] 找不到 deviceNo=${deviceNo} 的设备`);
    return false;
  }
  return sendFunctionStrengthToDevice(entry.id, funcCode, strength);
}

/** 向所有已连接设备的指定功能点发送强度（兼容旧单设备调用） */
async function sendFunctionStrength(funcCode: string, strength: number): Promise<boolean> {
  let success = false;
  for (const entry of devices.value.values()) {
    try {
      const result = await sendFunctionStrengthToDevice(entry.id, funcCode, strength);
      if (result) success = true;
    } catch { /* skip */ }
  }
  return success;
}

export function useBluetooth() {
  const connect = async (): Promise<void> => {
    if (!('bluetooth' in navigator)) {
      toastr.error('当前浏览器不支持 Web Bluetooth API');
      return;
    }
    connecting.value = true;
    try {
      const device = await (navigator as Navigator & { bluetooth: Bluetooth }).bluetooth.requestDevice({
        filters: [{ namePrefix: 'MY' }],
        optionalServices: [serviceUuid],
      });

      if (devices.value.has(device.id)) {
        toastr.info('该设备已连接');
        return;
      }

      await connectToDevice(device);
      toastr.success(`蓝牙设备 ${device.name || '未知'} 连接成功`);
    } catch (error) {
      if ((error as Error).name !== 'NotFoundError') {
        toastr.error(`连接失败: ${(error as Error).message}`);
      }
    } finally {
      connecting.value = false;
    }
  };

  const autoReconnect = async (): Promise<void> => {
    let ids: string[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) ids = JSON.parse(raw);
    } catch {
      return;
    }
    if (ids.length === 0 || connecting.value) return;

    const nav = navigator as Navigator & { bluetooth?: Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> } };
    if (!nav.bluetooth?.getDevices) return;

    try {
      connecting.value = true;
      const knownDevices = await nav.bluetooth.getDevices();
      for (const id of ids) {
        if (devices.value.has(id)) continue;
        const cached = knownDevices.find(d => d.id === id);
        if (cached) {
          try {
            await connectToDevice(cached);
          } catch (e) {
            console.error(`[Bluetooth] 自动重连设备 ${id} 失败:`, e);
          }
        }
      }
    } catch (error) {
      console.error('[Bluetooth] 自动重连失败:', error);
    } finally {
      connecting.value = false;
    }
  };

  onMounted(() => {
    if (devices.value.size === 0 && !connecting.value) {
      autoReconnect();
    }
  });

  return {
    devices,
    connecting,
    hasConnectedDevice,
    connectedDevices,
    allDeviceInfos,
    promptInjectionEnabled,
    connect,
    disconnectDevice,
    disconnectAll,
    sendToDevice,
    sendFunctionStrength,
    sendFunctionStrengthToDevice,
    sendFunctionStrengthByDeviceNo,
  };
}
