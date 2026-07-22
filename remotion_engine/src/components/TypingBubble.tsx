import React from "react";

export const TypingBubble: React.FC = () => {
  return (
    <div
      style={{
        background: "#141c13",
        border: "1px solid #253422",
        borderRadius: "20px",
        padding: "16px 28px",
        display: "inline-flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#9ac93b", opacity: 0.4 }} />
      <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#9ac93b", opacity: 0.8 }} />
      <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#9ac93b", opacity: 0.4 }} />
    </div>
  );
};
