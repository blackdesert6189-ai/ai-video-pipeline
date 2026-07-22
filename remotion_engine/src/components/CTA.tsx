import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface CTAProps {
  headline: string;
  buttonText: string;
  startFrame?: number;
}

export const CTA: React.FC<CTAProps> = ({
  headline,
  buttonText,
  startFrame = 345,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [startFrame, startFrame + 12], [0.9, 1.0], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(11, 15, 10, 0.94)",
        borderRadius: "36px",
        padding: "60px",
        textAlign: "center",
        width: "880px",
      }}
    >
      <div
        style={{
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "44px",
          fontWeight: 800,
          marginBottom: "36px",
          color: "#ffffff",
          lineHeight: 1.2,
        }}
      >
        {headline}
      </div>
      <div
        style={{
          background: "#9ac93b",
          color: "#0b0f0a",
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "36px",
          fontWeight: 800,
          padding: "22px 48px",
          borderRadius: "44px",
          boxShadow: "0 15px 40px rgba(154, 201, 59, 0.4)",
          transform: `scale(${scale})`,
        }}
      >
        {buttonText}
      </div>
    </div>
  );
};
