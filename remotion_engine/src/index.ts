import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";
import { loadFont } from "@remotion/google-fonts/BeVietnamPro";

// Load Be Vietnam Pro font globally for high-quality Vietnamese diacritics support
loadFont("normal", {
  weights: ["400", "700", "900"],
});

registerRoot(RemotionRoot);
