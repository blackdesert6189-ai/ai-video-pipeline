import React from "react";

interface AIResponseProps {
  title?: string;
  children: React.ReactNode;
}

export const AIResponse: React.FC<AIResponseProps> = ({
  title = "💡 CNFI AI COACH GỢI Ý",
  children,
}) => {
  return (
    <div
      style={{
        background: "#141c13",
        border: "2px solid #9ac93b",
        borderRadius: "28px",
        padding: "32px",
        width: "100%",
        boxSizing: "border-box",
        boxShadow: "0 20px 50px rgba(0,0,0,0.8)",
      }}
    >
      <div
        style={{
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "24px",
          fontWeight: 700,
          color: "#9ac93b",
          marginBottom: "20px",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "27px",
          fontWeight: 500,
          color: "#f2f4ee",
          lineHeight: 1.4,
        }}
      >
        {children}
      </div>
    </div>
  );
};
