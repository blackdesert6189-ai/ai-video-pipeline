import React from "react";

interface StoryBeatProps {
  beatName: string;
  startFrame: number;
  endFrame: number;
  children: React.ReactNode;
}

export const StoryBeat: React.FC<StoryBeatProps> = ({
  startFrame,
  endFrame,
  children,
}) => {
  return (
    <>
      {children}
    </>
  );
};
