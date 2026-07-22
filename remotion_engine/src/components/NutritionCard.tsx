import React from "react";

interface NutritionItem {
  name: string;
  kcal: number;
}

interface NutritionCardProps {
  title: string;
  items: NutritionItem[];
  totalKcal: number;
}

export const NutritionCard: React.FC<NutritionCardProps> = ({
  title,
  items,
  totalKcal,
}) => {
  return (
    <div
      style={{
        background: "rgba(18, 24, 17, 0.95)",
        border: "2px solid #9ac93b",
        borderRadius: "32px",
        padding: "44px 40px",
        width: "880px",
        textAlign: "center",
        boxShadow: "0 20px 50px rgba(154, 201, 59, 0.2)",
      }}
    >
      <div
        style={{
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "28px",
          color: "#9ac93b",
          fontWeight: 700,
          marginBottom: "24px",
        }}
      >
        {title}
      </div>
      {items.map((item, idx) => (
        <div
          key={idx}
          style={{
            fontFamily: "'Be Vietnam Pro', sans-serif",
            fontSize: "34px",
            fontWeight: 500,
            color: "#ffffff",
            marginBottom: "16px",
          }}
        >
          • {item.name} (~{item.kcal} kcal)
        </div>
      ))}
      <div
        style={{
          background: "#9ac93b",
          color: "#0b0f0a",
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: "38px",
          fontWeight: 800,
          padding: "16px 32px",
          borderRadius: "20px",
          marginTop: "24px",
        }}
      >
        TỔNG: ~{totalKcal} KCAL (AN TOÀN)
      </div>
    </div>
  );
};
