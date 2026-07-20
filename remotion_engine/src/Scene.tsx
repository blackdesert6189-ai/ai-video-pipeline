import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, staticFile, Audio, Sequence, interpolate, Easing, getInputProps } from "remotion";
import { Video } from "@remotion/media";
import { ThreeCanvas } from "@remotion/three";
import { getPhoneLayout } from "./helpers/layout";
import { Phone } from "./Phone";

// Đọc tham số phiên bản A/B/C từ Input Props
const { version = "C" } = getInputProps() as { version?: "A" | "B" | "C" };

// Component phụ đề Kinetic Typography
const KineticSubtitle: React.FC<{ text: string; frame: number; duration: number }> = ({ text, frame, duration }) => {
  const words = useMemo(() => text.split(" "), [text]);
  const wordDuration = useMemo(() => duration / words.length, [duration, words.length]);

  return (
    <div style={{
      position: "absolute",
      bottom: "200px",
      width: "100%",
      display: "flex",
      justifyContent: "center",
      zIndex: 100,
      fontFamily: "'Be Vietnam Pro', sans-serif"
    }}>
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "baseline",
        gap: "14px",
        background: "rgba(0, 0, 0, 0.85)",
        padding: "20px 40px",
        borderRadius: "24px",
        border: "3px solid rgba(255, 255, 255, 0.18)",
        boxShadow: "0 15px 45px rgba(0,0,0,0.6)",
        maxWidth: "900px",
        lineHeight: "1.2"
      }}>
        {words.map((word, i) => {
          const wordStartFrame = i * wordDuration;
          const wordFrame = frame - wordStartFrame;
          const isActive = wordFrame >= 0 && wordFrame < wordDuration;

          const transWidth = Math.min(3, wordDuration * 0.25);
          const wordScale = interpolate(
            wordFrame,
            [0, transWidth, wordDuration - transWidth, wordDuration],
            [1.0, 1.15, 1.15, 1.0],
            {
              easing: Easing.bezier(0.25, 0.1, 0.25, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp"
            }
          );

          return (
            <span
              key={i}
              style={{
                fontSize: "44px",
                fontWeight: isActive ? 900 : 700,
                color: isActive ? "#a6ff3d" : "#ffffff",
                transform: `scale(${wordScale})`,
                textShadow: isActive ? "0 0 25px rgba(166, 255, 61, 0.95)" : "none",
                display: "inline-block",
                textTransform: "uppercase",
                letterSpacing: "0.5px"
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export const Scene: React.FC = () => {
  const frame = useCurrentFrame();

  const mediaMetadata = useMemo(() => ({
    dimensions: {
      width: 692,
      height: 1538
    }
  }), []);

  const layout = useMemo(() => {
    const aspectRatio = 692 / 1538;
    return getPhoneLayout(aspectRatio, 0.95);
  }, []);

  const ctaScale = useMemo(() => {
    if (frame < 240) return 0;
    return interpolate(frame - 240, [0, 20], [0, 1.0], {
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    });
  }, [frame]);

  const climaxScale = useMemo(() => {
    if (frame < 155) return 0;
    return interpolate(frame - 155, [0, 15, 30], [0, 1.25, 1.0], {
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    });
  }, [frame]);

  const showClimax = frame >= 155 && frame < 240;

  // Cấu hình nhãn dán Hook theo phiên bản
  const hookSticker = useMemo(() => {
    if (version === "A") return null;
    if (version === "B") {
      return (
        <div style={{
          background: "#a6ff3d",
          color: "#000000",
          fontSize: "64px",
          fontWeight: 900,
          padding: "20px 40px",
          borderRadius: "20px",
          boxShadow: "0 20px 50px rgba(166, 255, 61, 0.4)",
          textTransform: "uppercase",
          letterSpacing: "1px",
          transform: `rotate(-4deg) scale(${interpolate(frame, [0, 15, 30, 45], [0.95, 1.05, 0.95, 1.0], { extrapolateRight: "clamp" })})`
        }}>
          🤔 BAO NHIÊU CALO?
        </div>
      );
    }
    return (
      <div style={{
        background: "#ffffff",
        color: "#000000",
        fontSize: "60px",
        fontWeight: 900,
        padding: "18px 36px",
        borderRadius: "20px",
        boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
        border: "3px solid #000000",
        textTransform: "uppercase",
        letterSpacing: "1px",
        transform: `rotate(-3deg) scale(${interpolate(frame, [0, 15, 30, 45], [0.95, 1.05, 0.95, 1.0], { extrapolateRight: "clamp" })})`
      }}>
        BAO NHIÊU CALO?
      </div>
    );
  }, [frame]);

  const climaxText = useMemo(() => {
    if (version === "B") return "🔥 CHỈ 542 CALO!";
    return "CHỈ 542 CALO!";
  }, []);

  const ctaButtonText = useMemo(() => {
    if (version === "A") return "TẢI CNFI HEALTH";
    if (version === "B") return "👉 QUÉT THỬ MÓN BẠN VỪA ĂN!";
    return "QUÉT THỬ BỮA ĂN CỦA BẠN";
  }, []);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      
      {/* 
        Sử dụng CSS filter: blur trực tiếp trên duy nhất 1 video B-roll đang phát để chuyển tiếp.
        Điều này triệt tiêu hoàn toàn lỗi chớp đen phát sinh do việc nạp tệp video khác (src swap).
      */}
      <Video
        src={staticFile("broll_pork.mp4")}
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          // Blur fade-in mượt 6 frames (42→48) thay vì hard-cut tại frame 45
          filter: `blur(${interpolate(frame, [42, 48], [0, 20], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
          // Crossfade opacity sang broll_pasta mượt 8 frames (131→139)
          opacity: interpolate(frame, [131, 139], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
        muted
        volume={0}
      />
      <Video
        src={staticFile("broll_pasta.mp4")}
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          // Blur fade-out mượt 6 frames (237→243) thay vì hard-cut tại frame 240
          filter: `blur(${interpolate(frame, [237, 243], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
          // Crossfade opacity từ broll_pork mượt 8 frames (131→139)
          opacity: interpolate(frame, [131, 139], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
        delayInFrames={131}
        muted
        volume={0}
      />

      {/* Hook Sticker Overlay */}
      {frame < 45 && hookSticker && (
        <div style={{
          position: "absolute",
          top: "40%",
          width: "100%",
          display: "flex",
          justifyContent: "center",
          zIndex: 90,
          fontFamily: "'Be Vietnam Pro', sans-serif"
        }}>
          {hookSticker}
        </div>
      )}

      {/* 2. 3D Phone Scene */}
      <Sequence from={45} durationInFrames={195}>
        <ThreeCanvas linear width={1080} height={1920} style={{ position: "absolute", inset: 0, zIndex: 10 }}>
          <ambientLight intensity={1.6} color={0xffffff} />
          <pointLight position={[10, 10, 5]} intensity={1.3} />
          <Phone
            phoneColor="#111827"
            phoneLayout={layout}
            mediaMetadata={mediaMetadata}
          />
        </ThreeCanvas>
      </Sequence>

      {/* 3. Đồ họa chuyển động Climax (Pop-Up calo) */}
      {showClimax && (
        <div style={{
          position: "absolute",
          top: "300px",
          width: "100%",
          display: "flex",
          justifyContent: "center",
          zIndex: 85,
          transform: `scale(${climaxScale})`,
          fontFamily: "'Be Vietnam Pro', sans-serif"
        }}>
          <div style={{
            background: version === "B" 
              ? "linear-gradient(135deg, #ef4444, #b91c1c)" 
              : "linear-gradient(135deg, #1f2937, #111827)",
            color: "#ffffff",
            fontSize: "48px",
            fontWeight: 900,
            padding: "24px 50px",
            borderRadius: "20px",
            boxShadow: version === "B"
              ? "0 20px 50px rgba(239, 68, 68, 0.4)"
              : "0 20px 50px rgba(0, 0, 0, 0.5)",
            border: "4px solid #ffffff",
            textTransform: "uppercase",
            letterSpacing: "1px"
          }}>
            {climaxText}
          </div>
        </div>
      )}

      {/* 4. Lớp phủ Outro CTA */}
      {frame >= 240 && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.55)",
          zIndex: 80,
          transform: `scale(${ctaScale})`
        }}>
          <button style={{
            background: version === "A"
              ? "linear-gradient(135deg, #ffffff, #e5e7eb)"
              : "linear-gradient(135deg, #a6ff3d, #80d91a)",
            color: "#050505",
            fontSize: "52px",
            fontWeight: 900,
            padding: "36px 80px",
            borderRadius: "60px",
            boxShadow: version === "A"
              ? "0 20px 60px rgba(255, 255, 255, 0.25)"
              : "0 20px 60px rgba(166, 255, 61, 0.6)",
            border: "none",
            textTransform: "uppercase",
            letterSpacing: "1px",
            fontFamily: "'Be Vietnam Pro', sans-serif"
          }}>
            {ctaButtonText}
          </button>
        </div>
      )}

      {/* 5. Logo CNFI góc phải */}
      <div style={{ position: "absolute", top: "60px", right: "60px", zIndex: 120 }}>
        <img src={staticFile("logo.png")} style={{ width: "120px", height: "auto" }} />
      </div>

      {/* 6. Phụ đề động Kinetic Subtitles */}
      {frame < 45 && <KineticSubtitle text="Bữa cơm nhà thế này bao nhiêu calo?" frame={frame} duration={45} />}
      {frame >= 45 && frame < 135 && <KineticSubtitle text="Chụp 2 góc bằng AI!" frame={frame - 45} duration={90} />}
      {frame >= 135 && frame < 240 && <KineticSubtitle text="Bóc tách từng món chính xác!" frame={frame - 135} duration={105} />}
      {frame >= 240 && <KineticSubtitle text="Quét calo thử ngay!" frame={frame - 240} duration={75} />}

      {/* 7. Nhạc nền và SFX */}
      <Audio src={staticFile("music.mp3")} volume={0.12} loop />
      <Audio src={staticFile("sfx_whoosh.mp3")} volume={0.25} startFrom={0} delayInFrames={0} />
      <Audio src={staticFile("sfx_chime.mp3")} volume={0.3} startFrom={0} delayInFrames={155} />
    </AbsoluteFill>
  );
};
