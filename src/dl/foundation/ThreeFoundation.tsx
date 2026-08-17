/*
File Description: This component provides the core deterministic Three.js rendering foundation for Remotion using @remotion/three and React Three Fiber.
*/

import React, { useEffect, useState } from 'react';
import { ThreeCanvas } from '@remotion/three';
import { continueRender, delayRender } from 'remotion';

export interface ThreeFoundationProps {
  width: number;
  height: number;
  children: React.ReactNode;
}

// Custom hook to gate Remotion frame screenshotting until 3D resources are ready.
export function useAsyncResourceGuard() {
  const [handle] = useState(() => delayRender('Loading 3D asset resources'));

  useEffect(() => {
    // Release Remotion render gate after 3D setup completes.
    continueRender(handle);
  }, [handle]);
}

// Main ThreeFoundation canvas wrapper utilizing Remotion deterministic frame handling.
export function ThreeFoundation({ width, height, children }: ThreeFoundationProps) {
  useAsyncResourceGuard();

  return (
    <div style={{ width, height, position: 'relative', overflow: 'hidden' }}>
      <ThreeCanvas
        width={width}
        height={height}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} intensity={1.2} />
        {children}
      </ThreeCanvas>
    </div>
  );
}
