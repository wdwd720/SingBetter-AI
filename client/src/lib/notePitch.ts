import type { PitchContour } from "./pitchMetrics";

export type NoteEvent = {
  start: number;
  end: number;
  midi: number;
  note: string;
  cents: number;
  stability: number;
};

export type NoteCoach = {
  noteAccuracyScore: number;
  intonationScore: number;
  worstNotes: Array<{
    note: string;
    start: number;
    end: number;
    centsOff: number;
    issue: string;
  }>;
  tips: string[];
  drill: {
    title: string;
    steps: string[];
    targetTime?: { start: number; end: number };
    repeatCount: number;
  };
  debug?: any;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const stddev = (values: number[]) => {
  if (!values.length) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
};

export const hzToMidi = (f0: number) => 69 + 12 * Math.log2(f0 / 440);

export const midiToNoteName = (midi: number) => {
  const rounded = Math.round(midi);
  const note = NOTE_NAMES[(rounded + 1200) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${note}${octave}`;
};

export function extractNoteEvents(
  contour: PitchContour,
  options?: { centsSplit?: number; gapSec?: number }
): NoteEvent[] {
  const centsSplit = options?.centsSplit ?? 80;
  const gapSec = options?.gapSec ?? 0.12;
  const frames = contour.frames;
  const events: NoteEvent[] = [];
  let current: Array<{ t: number; midi: number }> = [];
  let lastVoicedTime: number | null = null;
  let lastMidi: number | null = null;

  const flush = () => {
    if (!current.length) return;
    const midis = current.map((f) => f.midi);
    const medianMidi = median(midis);
    const cents = (medianMidi - Math.round(medianMidi)) * 100;
    const centsSpread = stddev(midis.map((m) => (m - medianMidi) * 100));
    const stability = clamp(Math.round(100 - centsSpread * 1.2), 0, 100);
    events.push({
      start: current[0].t,
      end: current[current.length - 1].t,
      midi: medianMidi,
      note: midiToNoteName(medianMidi),
      cents: Math.round(cents),
      stability,
    });
    current = [];
  };

  frames.forEach((frame) => {
    if (!frame.voiced || !frame.f0Hz) {
      if (lastVoicedTime !== null && frame.t - lastVoicedTime > gapSec) {
        flush();
        lastMidi = null;
      }
      return;
    }

    const midi = hzToMidi(frame.f0Hz);
    if (lastMidi !== null && Math.abs((midi - lastMidi) * 100) > centsSplit) {
      flush();
    }
    current.push({ t: frame.t, midi });
    lastMidi = midi;
    lastVoicedTime = frame.t;
  });

  flush();
  return events;
}

export function buildNoteCoach(input: {
  userContour: PitchContour;
  referenceContour?: PitchContour | null;
  referenceNotes?: NoteEvent[] | null;
}): NoteCoach {
  const userNotes = extractNoteEvents(input.userContour);
  const refNotes: NoteEvent[] =
    input.referenceNotes ??
    (input.referenceContour ? extractNoteEvents(input.referenceContour) : []);

  if (!userNotes.length || !refNotes.length) {
    return {
      noteAccuracyScore: 0,
      intonationScore: 0,
      worstNotes: [],
      tips: ["Not enough stable notes detected to score intonation."],
      drill: {
        title: "Note matching drill",
        steps: ["Hum a single note for 2 seconds, then sing it with words."],
        repeatCount: 2,
      },
      debug: { userNotes: userNotes.length, refNotes: refNotes.length },
    };
  }

  const matches: Array<{ user: NoteEvent; ref: NoteEvent; centsOff: number; overlap: number }> = [];

  for (const user of userNotes) {
    let bestRef: NoteEvent | null = null;
    let bestOverlap = 0;
    for (const ref of refNotes) {
      const overlap = Math.max(0, Math.min(user.end, ref.end) - Math.max(user.start, ref.start));
      if (overlap <= 0) continue;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestRef = ref;
      }
    }
    if (bestRef && bestOverlap > 0.08) {
      const centsOff = Math.round((user.midi - bestRef.midi) * 100);
      matches.push({ user, ref: bestRef, centsOff, overlap: bestOverlap });
    }
  }

  const absErrors = matches.map((m) => Math.abs(m.centsOff));
  const medianAbsError = absErrors.length ? median(absErrors) : 0;
  const pctWithin50 = absErrors.filter((e) => e <= 50).length / Math.max(1, absErrors.length);
  const noteAccuracyScore = clamp(Math.round(100 - medianAbsError * 0.9 - (1 - pctWithin50) * 25), 0, 100);
  const intonationScore = clamp(Math.round(100 - medianAbsError * 0.8), 0, 100);

  const worstNotes = matches
    .sort((a, b) => Math.abs(b.centsOff) - Math.abs(a.centsOff))
    .slice(0, 4)
    .map((match) => ({
      note: match.ref.note,
      start: match.user.start,
      end: match.user.end,
      centsOff: match.centsOff,
      issue: match.centsOff > 0 ? "sharp" : "flat",
    }));

  const bias = matches.length ? median(matches.map((m) => m.centsOff)) : 0;
  const tips: string[] = [];
  if (bias > 25) {
    tips.push(`You are sharp by about ${Math.round(bias)} cents on average.`);
  } else if (bias < -25) {
    tips.push(`You are flat by about ${Math.round(Math.abs(bias))} cents on average.`);
  }
  if (medianAbsError > 60) {
    tips.push("Land the target note sooner before adding vibrato.");
  }
  if (worstNotes[0]) {
    tips.push(`Focus the note ${worstNotes[0].note} where intonation drifts.`);
  }

  const target = worstNotes[0];

  return {
    noteAccuracyScore,
    intonationScore,
    worstNotes,
    tips: tips.slice(0, 4),
    drill: {
      title: "Intonation drill",
      steps: [
        "Hum the target note for 2 seconds.",
        "Sing the word on 'oo' twice, then add the lyric.",
        "Repeat the phrase slowly 3 times.",
      ],
      targetTime: target ? { start: target.start, end: target.end } : undefined,
      repeatCount: 3,
    },
    debug: {
      matches: matches.length,
      medianAbsError,
      bias,
    },
  };
}
