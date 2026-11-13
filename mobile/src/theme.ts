export const colors = {
  bone: "#FAF8F3",
  white: "#FFFFFF",
  line: "#E4E0D4",
  ink: "#14161A",
  secondary: "#51565F",
  navy: "#14284B",
  gold: "#F2B705",
  win: "#1F9D63",
  draw: "#C98A0B",
  loss: "#D64545",
} as const;

export const APP_DESCRIPTION =
  "Soccer Away Day is a schedule companion for ECNL families. It is not affiliated with, endorsed by, or sponsored by ECNL.";

export function resultColor(result: "W" | "D" | "L" | "win" | "draw" | "loss"): string {
  if (result === "W" || result === "win") return colors.win;
  if (result === "L" || result === "loss") return colors.loss;
  return colors.draw;
}
