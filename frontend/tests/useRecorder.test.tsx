import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRecorder } from '../src/hooks/useRecorder';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('uses the selected input and releases it when the component unmounts',async()=>{
  const stop = vi.fn();
  const stream = {getTracks:()=>[{stop}],getAudioTracks:()=>[{label:'Headset'}]};
  const getUserMedia=vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia,enumerateDevices:vi.fn().mockResolvedValue([{deviceId:'headset',kind:'audioinput',label:'Headset'}])}});
  class Recorder {
    state='inactive'; static isTypeSupported(){return true;}
    start(){this.state='recording';} stop(){this.state='inactive';}
  }
  vi.stubGlobal('MediaRecorder',Recorder);
  const {result,unmount}=renderHook(()=>useRecorder());
  await waitFor(()=>expect(result.current.devices).toHaveLength(1));
  act(()=>result.current.setDeviceId('headset'));
  await act(async()=>{await result.current.startRecording();});
  expect(getUserMedia).toHaveBeenCalledWith({audio:{deviceId:{exact:'headset'}}});
  expect(result.current.activeMicrophone).toBe('Headset');
  expect(result.current.isRecording).toBe(true);
  unmount();
  expect(stop).toHaveBeenCalled();
});
it('explains when the selected microphone is no longer connected',async()=>{
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockRejectedValue(Object.assign(new Error(),{name:'OverconstrainedError'})),enumerateDevices:vi.fn().mockResolvedValue([])}});
  const {result}=renderHook(()=>useRecorder());
  await act(async()=>{await result.current.startRecording();});
  expect(result.current.errorMessage).toMatch(/seleccionado ya no está disponible/);
});
