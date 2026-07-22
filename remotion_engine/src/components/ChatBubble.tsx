import React from "react";

interface ChatBubbleProps {
  sender: "user" | "ai";
  text: string;
  timestamp?: string;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  sender,
  text,
  timestamp,
}) => {
  const isUser = sender === "user";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        width: "100%",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          background: isUser ? "#1c2619" : "#141c13",
          border: isUser ? "1.5px solid #32442c" : "2px solid #9ac93b",
          borderRadius: "24px",
          padding: "20px 28px",
          maxWidth: "800px",
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "27px",
          fontWeight: 500,
          color: "#ffffff",
          boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        }}
      >
        {text}
      </div>
      {timestamp && (
        <span
          style={{
            fontFamily: "'Be Vietnam Pro', sans-serif",
            fontSize: "20px",
            color: "#7a8575",
            marginTop: "6px",
            paddingLeft: "8px",
            paddingRight: "8px",
          }}
        >
          {timestamp}
        </span>
      )}
    </div>
  );
};
