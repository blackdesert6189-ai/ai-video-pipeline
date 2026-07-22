import React from "react";
import { Composition } from "remotion";
import { SceneDraftReel05 } from "./SceneDraftReel05";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SceneDraftReel05"
        component={SceneDraftReel05}
        fps={30}
        durationInFrames={450} // 15 seconds * 30 fps = 450 frames
        width={1080}
        height={1920}
      />
    </>
  );
};
