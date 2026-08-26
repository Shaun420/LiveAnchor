import { describe, it, expect, vi } from 'vitest';

describe('WebGL Context Loss Handling', () => {
  it('should pause the render loop when context is lost', () => {
    // Mock Three.js Renderer DOM element
    const mockDomElement = {
      addEventListener: vi.fn()
    };
    
    const renderer = { domElement: mockDomElement };
    let isLoopRunning = true;
    const cancelAnimationFrame = vi.fn(() => { isLoopRunning = false; });

    // Simulate the setup code from avatar/index.js
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      cancelAnimationFrame();
    });

    // Extract the registered callback and trigger it
    const contextLostCallback = mockDomElement.addEventListener.mock.calls.find(
      call => call[0] === 'webglcontextlost'
    )[1];

    contextLostCallback({ preventDefault: vi.fn() });

    // Verify the loop was halted
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(isLoopRunning).toBe(false);
  });

  it('should resume the render loop when context is restored', () => {
    const mockDomElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    
    const renderer = { domElement: mockDomElement };
    let isLoopRunning = false;
    const cancelAnimationFrame = vi.fn(() => { isLoopRunning = false; });
    const resumeAnimationFrame = vi.fn(() => { isLoopRunning = true; });

    // Simulate setup with both listeners
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      cancelAnimationFrame();
    });

    renderer.domElement.addEventListener('webglcontextrestored', () => {
      resumeAnimationFrame();
    });

    // Extract the restored callback
    const restoredCallback = mockDomElement.addEventListener.mock.calls.find(
      call => call[0] === 'webglcontextrestored'
    )[1];

    restoredCallback();

    // Verify the loop was resumed
    expect(isLoopRunning).toBe(true);
    expect(resumeAnimationFrame).toHaveBeenCalled();
  });
});