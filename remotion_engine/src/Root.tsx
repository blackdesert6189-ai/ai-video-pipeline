import { Composition } from "remotion";
import { Scene } from "./Scene";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Scene"
        component={Scene}
        fps={30}
        durationInFrames={315} // 10.5 seconds * 30 fps = 315 frames
        width={1080}
        height={1920}
      />
    </>
  );
};
