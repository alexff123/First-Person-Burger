import type { EventBus } from '../core/EventBus';
import { ObjectPool } from '../core/ObjectPool';
import { Events } from '../game/events';
import type { GameEvents } from '../game/events';

/** 播放通道：一个 Voice = 一个可复用的 GainNode。 */
interface Voice {
  gain: GainNode;
}

/**
 * 音效管理器（占位音效，全部程序化合成，无需音频资源文件）
 * 对象池管理：
 *   - 声音缓冲(AudioBuffer)预生成后缓存，按名字复用；
 *   - 播放通道(Voice=GainNode)用 ObjectPool 复用，并对并发发声数封顶，避免无界创建节点。
 * 注意：WebAudio 的 BufferSource 是一次性的，无法重复播放；因此池化的是"通道"，源节点用完即回收。
 *
 * 档位映射（正反馈给上行乐音，负反馈给下行/噪声）：
 *   完美 → serve（双音上行）｜ 生食/过火 → soft（单音闷）｜ 焦糊 → burn（锯齿低鸣）
 *   断连 → break（下行双音，专门为"痛感"配的）
 */
export class AudioManager {
  private ctx?: AudioContext;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices: ObjectPool<Voice>;
  private readonly activeVoices = new Set<Voice>();
  private readonly maxVoices = 12;

  constructor(bus: EventBus<GameEvents>) {
    this.voices = new ObjectPool<Voice>(
      () => ({ gain: this.ctx!.createGain() }),
      (v) => {
        v.gain.gain.cancelScheduledValues(0);
      },
      0, // 未解锁前不预创建（AudioContext 还没建立）
    );

    // 浏览器自动播放策略：首次用户手势后再初始化
    const unlock = (): void => {
      this.init();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);

    bus.on(Events.DishPrepared, () => this.play('chop'));
    bus.on(Events.DishCooked, ({ grade }) => {
      if (grade === 'perfect') this.play('serve');
      else if (grade === 'burnt') this.play('burn');
      else this.play('soft');
    });
    bus.on(Events.ComboChanged, ({ broke }) => {
      if (broke) this.play('break');
    });
    bus.on(Events.CoinEarned, ({ net }) => {
      if (net > 0) this.play('coin');
    });
  }

  private init(): void {
    if (this.ctx) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    void this.ctx.resume();

    this.buffers.set('chop', this.makeNoise(0.08, 0.9)); // 切菜：短噪声
    this.buffers.set('serve', this.makeTones([660, 990], 0.18, 0.4)); // 上菜成功：上行乐音
    this.buffers.set('soft', this.makeTones([330], 0.14, 0.3)); // 生食/过火：闷音
    this.buffers.set('break', this.makeTones([420, 240], 0.2, 0.34)); // 连击断档：下行双音
    this.buffers.set('coin', this.makeTones([1320, 1760], 0.09, 0.3)); // 金币
    this.buffers.set('burn', this.makeBuzz(0.35, 0.45)); // 焦糊：低鸣 + 噪声
  }

  /** 播放一个占位音效；通道占满则丢弃本次（避免无界发声）。 */
  play(name: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    if (this.activeVoices.size >= this.maxVoices) return;

    const voice = this.voices.acquire();
    voice.gain.gain.value = 0.5;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(voice.gain).connect(ctx.destination);
    src.onended = () => {
      this.activeVoices.delete(voice);
      this.voices.release(voice);
    };
    this.activeVoices.add(voice);
    src.start();
  }

  private makeNoise(dur: number, amp: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * amp * Math.pow(1 - t, 3);
    }
    return buf;
  }

  private makeTones(freqs: number[], dur: number, amp: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const seg = n / freqs.length;
    for (let i = 0; i < n; i++) {
      const f = freqs[Math.min(freqs.length - 1, Math.floor(i / seg))];
      const t = i / n;
      d[i] = Math.sin((2 * Math.PI * f * i) / ctx.sampleRate) * amp * Math.pow(1 - t, 2);
    }
    return buf;
  }

  private makeBuzz(dur: number, amp: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const saw = 2 * (((i * 110) / ctx.sampleRate) % 1) - 1;
      d[i] = (saw * 0.6 + (Math.random() * 2 - 1) * 0.4) * amp * Math.pow(1 - t, 2);
    }
    return buf;
  }
}
