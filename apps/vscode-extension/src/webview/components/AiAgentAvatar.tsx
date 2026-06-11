const SATURATION = 55;
const LIGHTNESS = 45;

function slugToHue(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = slug.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ((hash % 360) + 360) % 360;
}

function firstLetter(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function AiAgentAvatar(props: {
  displayName: string;
  iconPath?: string | null;
  slug: string;
  size?: number;
}) {
  const { displayName, iconPath, slug } = props;
  const size = props.size ?? 24;
  const hue = slugToHue(slug);

  if (iconPath) {
    const iconUri = `icons/${iconPath}`;
    return (
      <img
        src={iconUri}
        alt={displayName}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover"
        }}
      />
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: `hsl(${hue}, ${SATURATION}%, ${LIGHTNESS}%)`,
        color: "#fff",
        fontSize: Math.max(10, Math.round(size * 0.45)),
        fontWeight: 600,
        lineHeight: 1,
        userSelect: "none"
      }}
      title={displayName}
    >
      {firstLetter(displayName)}
    </span>
  );
}
