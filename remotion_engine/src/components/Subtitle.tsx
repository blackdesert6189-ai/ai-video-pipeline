import React from "react";

interface SubtitleProps {
  text: string;
}

export const Subtitle: React.FC<SubtitleProps> = ({ text }) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          background: "rgba(18, 24, 17, 0.94)",
          color: "#9ac93b",
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "32px",
          fontWeight: 700,
          padding: "16px 32px",
          borderRadius: "20px",
          border: "1px solid #32442c",
          textAlign: "center",
          maxWidth: "960px",
          lineHeight: 1.3,
        }}
      >
        {text}
      </div>
    </div>
  );
};
