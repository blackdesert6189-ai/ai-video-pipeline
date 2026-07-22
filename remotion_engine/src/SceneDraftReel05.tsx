import { AbsoluteFill, Audio, Video, staticFile, useCurrentFrame, continueRender, delayRender, interpolate } from "remotion";
import React, { useEffect, useState } from "react";
import { theme } from "./theme/tokens";
import { SafeArea } from "./components/SafeArea";
import { StoryBeat } from "./components/StoryBeat";
import { HookHeadline } from "./components/HookHeadline";
import { ChatBubble } from "./components/ChatBubble";
import { TypingBubble } from "./components/TypingBubble";
import { AIResponse } from "./components/AIResponse";
import { NutritionCard } from "./components/NutritionCard";
import { CTA } from "./components/CTA";
import { Subtitle } from "./components/Subtitle";

export const SceneDraftReel05: React.FC = () => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender("Loading Be Vietnam Pro font"));

  useEffect(() => {
    // Font Load Guard: Load Be Vietnam Pro TTF weights into document.fonts
    const font500 = new FontFace("Be Vietnam Pro", `url(${staticFile("fonts/be-vietnam-pro-500.ttf")})`, { weight: "500" });
    const font700 = new FontFace("Be Vietnam Pro", `url(${staticFile("fonts/be-vietnam-pro-700.ttf")})`, { weight: "700" });
    const font800 = new FontFace("Be Vietnam Pro", `url(${staticFile("fonts/be-vietnam-pro-800.ttf")})`, { weight: "800" });

    Promise.all([font500.load(), font700.load(), font800.load()])
      .then((loadedFonts) => {
        loadedFonts.forEach((f) => document.fonts.add(f));
        continueRender(handle);
      })
      .catch((err) => {
        console.error("FONT LOAD GUARD FAIL:", err);
        continueRender(handle);
      });
  }, [handle]);

  // AI Stream Response Text
  const aiFullText = "Chào bạn! Khi thèm ăn đêm, nên ưu tiên thực phẩm đạm nhẹ và chất xơ để ổn định cơn đói:\n\n• 100g Sữa chua không đường (~60 kcal)\n• 5 hạt Hạnh nhân (~35 kcal)\n\nTổng: ~95 kcal. An toàn & ngủ ngon.";
  const streamCharCount = frame >= 175 ? Math.floor(Math.min(1.0, (frame - 175) / 75) * aiFullText.length) : 0;
  const visibleAiText = aiFullText.substring(0, streamCharCount);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bgSlateDark, fontFamily: theme.fontFamily, color: theme.colors.textPrimary }}>
      
      {/* 1. Narrative B-roll (Beat 1 & 2: POV 23:00 Kitchen Fridge Opening - ZERO FILLER) */}
      {frame < 135 && (
        <Video
          src={staticFile("broll_reel05_narrative.mp4")}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          muted
          volume={0}
        />
      )}

      {/* Top Fixed Safe Zone Bar: Logo Mark */}
      <div data-qa-id="logo" style={{ position: "absolute", top: "60px", right: `${theme.safeZone.horizontal}px`, zIndex: 200 }}>
        <img src={staticFile("logo.png")} style={{ width: "96px", height: "auto" }} />
      </div>

      {/* Safe Area Layout Container */}
      <SafeArea>
        {/* TOP SAFE ZONE: Status & Hook Header Badges */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}>
          {/* Beat 1 [0.0s - 1.8s]: POV 23:00 Night Clock Badge */}
          {frame < 54 && (
            <StoryBeat beatName="Beat 1: Hook" startFrame={0} endFrame={54}>
              <div data-qa-id="hook">
                <HookHeadline text="🕒 23:00 ĐÊM • BỤNG CỒN CÀO?" badgeColor={theme.colors.signalDanger} borderColor={theme.colors.signalDanger} startFrame={0} />
              </div>
            </StoryBeat>
          )}

          {/* Beat 2 [1.8s - 4.5s]: Craving Dilemma Warning Badge */}
          {frame >= 54 && frame < 135 && (
            <StoryBeat beatName="Beat 2: Conflict" startFrame={54} endFrame={135}>
              <div data-qa-id="hook">
                <HookHeadline text="⚠️ DỄ ĂN QUÁ ĐÀ NẾU KHÔNG KẾ HOẠCH" badgeColor={theme.colors.textPrimary} borderColor={theme.colors.signalDanger} startFrame={54} />
              </div>
            </StoryBeat>
          )}
        </div>

        {/* MAIN STORY CONTENT ZONE — 100% NATIVE REMOTION REACT CHAT UI */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1, width: "100%" }}>
          
          {/* Beat 3 [4.5s - 8.5s]: Native Lux AI Chat Stream */}
          {frame >= 135 && frame < 255 && (
            <StoryBeat beatName="Beat 3: AI Intervention" startFrame={135} endFrame={255}>
              <div style={{
                display: "flex",
                flexDirection: "column",
                width: "880px",
                background: theme.colors.bgSlateDark,
                border: `2px solid ${theme.colors.brandPrimary}`,
                borderRadius: "32px",
                padding: "32px",
                boxShadow: "0 20px 50px rgba(0,0,0,0.8)",
                transform: `scale(${interpolate(frame, [135, 147], [0.92, 1.0], { extrapolateRight: "clamp" })})`
              }}>
                {/* User Chat Bubble */}
                <div data-qa-id="chat-user">
                  <ChatBubble sender="user" text="11h đêm đói quá, ăn gì bớt thèm mà không dư calo?" timestamp="23:02 • Đã gửi" />
                </div>

                {/* AI Typing Indicator */}
                {frame >= 150 && frame < 175 && (
                  <div style={{ marginTop: "16px" }}>
                    <TypingBubble />
                  </div>
                )}

                {/* AI Stream Response */}
                {frame >= 175 && (
                  <div data-qa-id="chat-ai" style={{ marginTop: "16px" }}>
                    <AIResponse title="💡 CNFI AI COACH GỢI Ý">
                      <div style={{ whiteSpace: "pre-wrap" }}>{visibleAiText}</div>
                    </AIResponse>
                  </div>
                )}
              </div>
            </StoryBeat>
          )}

          {/* Beat 4 [8.5s - 11.5s]: Macro Result Card (~95 kcal) */}
          {frame >= 255 && frame < 345 && (
            <StoryBeat beatName="Beat 4: Resolution" startFrame={255} endFrame={345}>
              <div data-qa-id="result">
                <NutritionCard
                  title="💡 THỰC ĐƠN GỢI Ý TỪ AI COACH"
                  items={[
                    { name: "100g Sữa chua không đường", kcal: 60 },
                    { name: "5 hạt Hạnh nhân", kcal: 35 }
                  ]}
                  totalKcal={95}
                />
              </div>
            </StoryBeat>
          )}

          {/* Beat 5 [11.5s - 15.0s]: Actionable CTA */}
          {frame >= 345 && (
            <StoryBeat beatName="Beat 5: CTA" startFrame={345} endFrame={450}>
              <div data-qa-id="cta">
                <CTA
                  headline="HỎI AI COACH BỮA ĐÊM TỐI NAY"
                  buttonText="TRẢI NGHIỆM AI COACH MIỄN PHÍ"
                  startFrame={345}
                />
              </div>
            </StoryBeat>
          )}
        </div>

        {/* BOTTOM SAFE ZONE: Kinetic Subtitles */}
        <div data-qa-id="subtitle">
          <Subtitle
            text={
              frame < 54
                ? "11 giờ đêm, bạn cồn cào thèm ăn và muốn mở tủ lạnh?"
                : frame >= 54 && frame < 135
                ? "Dễ ăn quá đà hoặc chọn thực phẩm nhiều calo nếu không có kế hoạch."
                : frame >= 135 && frame < 255
                ? "Mở AI Coach để nhận gợi ý món nhẹ bụng và hợp lý cho buổi tối."
                : frame >= 255 && frame < 345
                ? "Gợi ý: 1 hũ sữa chua không đường và 5 hạt hạnh nhân, khoảng 95 kcal."
                : "Theo dõi và kiểm soát calo thông minh cùng CNFI Health."
            }
          />
        </div>
      </SafeArea>

      {/* Audio Layer */}
      <Audio src={staticFile("music.mp3")} volume={0.10} loop />
    </AbsoluteFill>
  );
};
