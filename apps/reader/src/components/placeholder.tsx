import ritoImg from '@/assets/rito.webp';

export function Placeholder() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute bottom-0 left-0 h-128 w-lg">
        <img
          src={ritoImg}
          alt="Rito"
          className="h-full w-full object-contain opacity-50"
          style={{
            objectPosition: 'bottom left',
            maskImage: 'radial-gradient(ellipse at bottom left, black 30%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at bottom left, black 30%, transparent 70%)',
          }}
        />
      </div>
    </div>
  );
}
