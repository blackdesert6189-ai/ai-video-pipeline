import React from "react";
import { theme } from "../theme/tokens";

interface SafeAreaProps {
  children: React.ReactNode;
}

export const SafeArea: React.FC<SafeAreaProps> = ({ children }) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        position: "relative",
        zIndex: 100,
        paddingTop: `${theme.safeZone.top}px`,
        paddingBottom: `${theme.safeZone.bottom}px`,
        paddingLeft: `${theme.safeZone.horizontal}px`,
        paddingRight: `${theme.safeZone.horizontal}px`,
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
};
