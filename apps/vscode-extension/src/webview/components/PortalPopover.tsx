import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type PopoverPosition = {
  top: number;
  left: number;
  minWidth: number;
};

export function PortalPopover(props: {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  onClose(): void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    function updatePosition() {
      const anchor = props.anchorRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      setPosition({
        top: Math.min(rect.bottom + 8, window.innerHeight - 24),
        left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 260) - 16),
        minWidth: rect.width
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchorRef]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (props.anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      props.onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        props.onClose();
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [props]);

  if (!position) {
    return null;
  }

  return createPortal(
    <div
      className="portal-popover"
      ref={popoverRef}
      style={{
        top: position.top,
        left: position.left,
        minWidth: position.minWidth
      }}
    >
      {props.children}
    </div>,
    document.body
  );
}
