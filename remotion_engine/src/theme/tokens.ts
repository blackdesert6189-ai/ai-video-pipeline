export const theme = {
  fontFamily: "'Be Vietnam Pro', sans-serif",
  colors: {
    brandPrimary: "#9ac93b",
    signalDanger: "#ff7a6b",
    bgSlateDark: "#0b0f0a",
    bgCardDark: "#141c13",
    bgUserBubble: "#1c2619",
    borderDark: "#253422",
    borderUserBubble: "#32442c",
    textPrimary: "#ffffff",
    textBody: "#f2f4ee",
    textMuted: "#7a8575",
  },
  safeZone: {
    top: 140,
    bottom: 220,
    horizontal: 72,
  },
  assetManifest: [
    {
      id: "broll_reel05_narrative",
      file: "broll_reel05_narrative.mp4",
      storyBeat: "Beat 1 & 2 (Hook & Conflict)",
      narrativePurpose: "Establish Context (POV 23:00 Kitchen Fridge Opening & Night Craving)",
      removalTest: "If removed, immediate 23:00 night craving context and instant noodles vs yogurt dilemma is lost",
      status: "PENDING_REVIEW"
    },
    {
      id: "music_background",
      file: "music.mp3",
      storyBeat: "Beat 1 to 5 (Full Video)",
      narrativePurpose: "Audio Atmosphere & Ambient Rhythm",
      removalTest: "If removed, video lacks audio tension and emotional engagement",
      status: "PENDING_REVIEW"
    }
  ]
} as const;
