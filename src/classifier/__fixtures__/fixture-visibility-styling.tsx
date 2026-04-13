// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — fixture is parsed by ts-morph for AST region mapping, not compiled
// Covers all styling patterns that can affect Playwright-observable behaviour:
//   - Tailwind: hidden, invisible, opacity-0, overflow-hidden, pointer-events-none, translate-*, sr-only
//   - CSS inline: display:none, visibility:hidden, opacity:0, overflow:hidden, pointer-events:none, transform, position, z-index

interface PanelProps {
  title: string;
  visible: boolean;
}

export const Panel = ({ title, visible: _visible }: PanelProps) => {
  return (
    <div>
      {/* Tailwind visibility cases */}
      <section className="hidden">Hidden section</section>
      <section className="invisible">Invisible section</section>
      <section className="opacity-0">Transparent section</section>
      <section className="w-0 h-0">Zero-size section</section>
      <section className="sr-only">Screen-reader-only text</section>

      {/* Tailwind layout cases */}
      <nav className="overflow-hidden">Clipped nav</nav>
      <button className="pointer-events-none">Non-interactive button</button>
      <div className="-translate-x-full">Translated off-screen</div>
      <div className="absolute z-10">Positioned element</div>

      {/* Inline style visibility cases */}
      <div style={{ display: 'none' }}>Display none</div>
      <div style={{ visibility: 'hidden' }}>Visibility hidden</div>
      <div style={{ opacity: 0 }}>Opacity zero</div>
      <div style={{ width: 0, height: 0 }}>Zero size</div>

      {/* Inline style layout cases */}
      <div style={{ overflow: 'hidden' }}>Clipped content</div>
      <div style={{ pointerEvents: 'none' }}>Non-interactive</div>
      <div style={{ transform: 'translateX(-100%)' }}>Off-screen</div>
      <div style={{ position: 'absolute', zIndex: 9 }}>Positioned</div>

      {/* Cosmetic-only — should still SKIP */}
      <h2
        className="text-blue-500 font-bold text-xl"
        style={{ color: 'red', fontWeight: 'bold', borderRadius: '4px' }}
      >
        {title}
      </h2>
    </div>
  );
};
