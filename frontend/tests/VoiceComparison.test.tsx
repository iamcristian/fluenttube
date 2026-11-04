import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VoiceComparison } from '../src/components/VoiceComparison';
import { request } from '../src/api/client';
import type { UseRecorderReturn } from '../src/hooks/useRecorder';
vi.mock('../src/api/client',()=>({request:vi.fn(),phoneticsAudioUrl:(p:string)=>'/api/phonetics'+p}));

it('uploads the recorded take for this lesson and explains a silent microphone',async()=>{
  const features={status:'unscorable',duration_seconds:1,voiced_ratio:0,pitch_times_seconds:[],pitch_semitones:[],pitch_range_semitones:null,pauses:[],warning_codes:[],rms_dbfs:-160};
  vi.mocked(request).mockResolvedValue({status:'unscorable',reference:features,recording:features,warning_codes:[]});
  const blob=new Blob(['take'],{type:'audio/webm'});
  const recorder={state:'recorded',devices:[],audioBlob:blob,audioUrl:'blob:take',refreshDevices:vi.fn()} as unknown as UseRecorderReturn;
  render(<VoiceComparison recorder={recorder} lessonId="fleece" word="sheep"/>);
  expect(screen.getByLabelText('Tu grabación')).toHaveAttribute('src','blob:take');
  fireEvent.click(screen.getByRole('button',{name:'Analizar y comparar con el ejemplo'}));
  expect(await screen.findByText(/La toma tiene un nivel muy bajo/)).toBeInTheDocument();
  const [path,options]=vi.mocked(request).mock.calls[0];
  expect(path).toBe('/phonetics/voice/fleece');
  expect((options?.body as FormData).get('audio_file')).toBeInstanceOf(File);
});
