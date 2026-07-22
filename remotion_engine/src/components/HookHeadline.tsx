import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface HookHeadlineProps {
  text: string;
  badgeColor?: string;
  borderColor?: string;
  startFrame?: number;
}

export const HookHeadline: React.FC<HookHeadlineProps> = ({
  text,
  badgeColor = "#ff7a6b",
  borderColor = "#ff7a6b",
  startFrame = 0,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [startFrame, startFrame + 12], [0.9, 1.0], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        background: "rgba(18, 24, 17, 0.94)",
        border: `1.5px solid ${borderColor}`,
        borderRadius: "28px",
        padding: "16px 36px",
        fontFamily: "'Be Vietnam Pro', sans-serif",
        fontSize: "32px",
        fontWeight: 800,
        color: badgeColor,
        boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
        transform: `scale(${scale})`,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
};
