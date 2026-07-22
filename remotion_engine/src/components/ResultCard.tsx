import React from "react";

interface ResultCardProps {
  headline: string;
  subheadline: string;
  highlightText: string;
}

export const ResultCard: React.FC<ResultCardProps> = ({
  headline,
  subheadline,
  highlightText,
}) => {
  return (
    <div
      style={{
        background: "rgba(18, 24, 17, 0.95)",
        border: "2px solid #9ac93b",
        borderRadius: "32px",
        padding: "40px",
        width: "880px",
        textAlign: "center",
        boxShadow: "0 20px 50px rgba(0,0,0,0.8)",
      }}
    >
      <div
        style={{
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "32px",
          fontWeight: 800,
          color: "#ffffff",
          marginBottom: "16px",
        }}
      >
        {headline}
      </div>
      <div
        style={{
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "26px",
          fontWeight: 500,
          color: "#a9afa2",
          marginBottom: "24px",
        }}
      >
        {subheadline}
      </div>
      <div
        style={{
          background: "#9ac93b",
          color: "#0b0f0a",
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "34px",
          fontWeight: 800,
          padding: "16px 32px",
          borderRadius: "20px",
        }}
      >
        {highlightText}
      </div>
    </div>
  );
};
