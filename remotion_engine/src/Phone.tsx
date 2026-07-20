import { useThree } from "@react-three/fiber";
import { Video } from "@remotion/media";
import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { interpolate, staticFile, useCurrentFrame, Easing, getInputProps } from "remotion";
import { CanvasTexture, Texture } from "three";
import { MediabunnyMetadata } from "./helpers/get-media-metadata";
import {
  CAMERA_DISTANCE,
  PHONE_CURVE_SEGMENTS,
  PHONE_SHININESS,
  PhoneLayout,
} from "./helpers/layout";
import { roundedRect } from "./helpers/rounded-rectangle";
import { RoundedBox } from "./RoundedBox";

const { version = "C" } = getInputProps() as { version?: "A" | "B" | "C" };

export const Phone: React.FC<{
  readonly phoneColor: string;
  readonly phoneLayout: PhoneLayout;
  readonly mediaMetadata: MediabunnyMetadata;
}> = ({ phoneColor, phoneLayout, mediaMetadata }) => {
  const frame = useCurrentFrame();
  const frameRef = useRef(frame);
  frameRef.current = frame;

  // Đặt camera góc gần
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.near = 0.2;
    camera.far = Math.max(5000, CAMERA_DISTANCE * 2);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  // C1 Continuity: Ổn định góc nghiêng từ frame 0 đến 75
  const rotateProgress = interpolate(frame, [0, 75], [0, 1], {
    easing: Easing.bezier(0.42, 0, 0.58, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const rotateY = interpolate(rotateProgress, [0, 1], [-0.15, 0.0]);
  const rotateX = interpolate(rotateProgress, [0, 1], [0.05, 0.0]);

  // C1 Continuity: Zoom máy mượt mà từ frame 90 đến 120
  const zoomProgress = interpolate(frame, [90, 120], [0, 1], {
    easing: Easing.bezier(0.42, 0, 0.58, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const targetScale = version === "A" ? 1.55 : version === "B" ? 2.2 : 1.85;
  const targetY = version === "A" ? 0.45 : version === "B" ? 0.85 : 0.72;

  const scale = interpolate(zoomProgress, [0, 1], [1.0, targetScale]);
  const positionY = interpolate(zoomProgress, [0, 1], [0.0, targetY]);

  // Tạo Shape hình chữ nhật bo góc cho màn hình
  const screenGeometry = useMemo(() => {
    return roundedRect({
      width: phoneLayout.screen.width,
      height: phoneLayout.screen.height,
      radius: phoneLayout.screen.radius,
    });
  }, [
    phoneLayout.screen.height,
    phoneLayout.screen.radius,
    phoneLayout.screen.width,
  ]);

  // Sử dụng HTML5 Canvas chuẩn để đạt tính ổn định cao nhất
  const [canvasTexture] = useState(() => {
    const canvas = document.createElement("canvas");
    canvas.width = mediaMetadata.dimensions.width;
    canvas.height = mediaMetadata.dimensions.height;
    return canvas;
  });

  const [context] = useState(() => {
    const ctx = canvasTexture.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get context");
    }
    return ctx;
  });

  const [texture] = useState<Texture>(() => {
    const tex = new CanvasTexture(canvasTexture);
    tex.repeat.y = 1 / phoneLayout.screen.height;
    tex.repeat.x = 1 / phoneLayout.screen.width;
    return tex;
  });

  const { invalidate } = useThree();

  // Đảm bảo callback tĩnh và kiểm soát vẽ đè chính xác theo frame của tiến trình cha
  const onVideoFrame1 = useCallback(
    (videoFrame: CanvasImageSource) => {
      if (frameRef.current < 90) {
        context.drawImage(videoFrame, 0, 0);
        texture.needsUpdate = true;
        invalidate();
      }
    },
    [context, texture, invalidate],
  );

  const onVideoFrame2 = useCallback(
    (videoFrame: CanvasImageSource) => {
      if (frameRef.current >= 90) {
        context.drawImage(videoFrame, 0, 0);
        texture.needsUpdate = true;
        invalidate();
      }
    },
    [context, texture, invalidate],
  );

  return (
    <group
      scale={scale}
      rotation={[rotateX, rotateY, 0]}
      position={[0, positionY, 0]}
    >
      {/* 
        Mount liên tục cả hai video và dùng delayInFrames={90} để trì hoãn phát reveal.mp4.
        Chromium sẽ tự động tải trước và giải mã frame đầu tiên (frame 0) của reveal.mp4, 
        giúp chuyển cảnh tại frame 90 mượt mà 100% không bị lệch/nhảy cóc khung hình.
      */}
      <Video
        src={staticFile("scan.mp4")}
        startFrom={0}
        playbackRate={1.8}
        onVideoFrame={onVideoFrame1}
        headless
        muted
      />

      <Video
        src={staticFile("reveal.mp4")}
        startFrom={0}
        delayInFrames={90}
        onVideoFrame={onVideoFrame2}
        headless
        muted
      />

      {/* Vỏ ốp lưng điện thoại */}
      <RoundedBox
        radius={phoneLayout.phone.radius}
        depth={phoneLayout.phone.thickness}
        curveSegments={PHONE_CURVE_SEGMENTS}
        position={phoneLayout.phone.position}
        width={phoneLayout.phone.width}
        height={phoneLayout.phone.height}
      >
        <meshPhongMaterial color={phoneColor} shininess={PHONE_SHININESS} />
      </RoundedBox>

      {/* Màn hình hiển thị video */}
      <mesh position={phoneLayout.screen.position}>
        <shapeGeometry args={[screenGeometry]} />
        <meshBasicMaterial color={0xffffff} toneMapped={false} map={texture} />
      </mesh>
    </group>
  );
};
