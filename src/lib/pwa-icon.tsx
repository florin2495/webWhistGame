import { ImageResponse } from "next/og";

/** Opaque, font-free app icon: green felt, white card, spade drawn as an SVG path. */
export function renderIcon(size: number, artScale: number): ImageResponse {
  const art = Math.round(size * artScale);
  const card = Math.round(art * 0.78);
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#14532d",
        }}
      >
        <div
          style={{
            width: card,
            height: Math.round(card * 1.25),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fafaf9",
            borderRadius: Math.round(card * 0.14),
          }}
        >
          <svg width={Math.round(card * 0.72)} height={Math.round(card * 0.72)} viewBox="0 0 100 100">
            <path
              d="M50 6 C50 6 12 38 12 60 C12 74 25 80 36 75 C40 73 43 70 44 67 C44 80 40 89 31 94 L69 94 C60 89 56 80 56 67 C57 70 60 73 64 75 C75 80 88 74 88 60 C88 38 50 6 50 6 Z"
              fill="#09090b"
            />
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
