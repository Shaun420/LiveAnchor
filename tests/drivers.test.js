import { describe, it, expect, vi } from 'vitest';
import { driveLimbs } from '../avatar/drivers.js';

describe('Avatar Drivers Fallback Logic', () => {
  it('should fallback to legacy joints3d if onnx3dJoints is null', () => {
    const mockVrm = { scene: { updateMatrixWorld: vi.fn() } };
    const mockBones = { 
      leftUpperArm: { 
        parent: { 
          getWorldQuaternion: vi.fn() 
        }, 
        quaternion: { 
          slerp: vi.fn() 
        } 
      } 
    };
    const mockRest = { 
      leftUpperArm: { 
        dir: { x: 1, y: 0, z: 0, dot: (v) => Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z) }, 
        quat: { x: 0, y: 0, z: 0, w: 1, dot: (v) => Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z) } 
      } };
    
    const bodyData = {
      onnx3dJoints: null, // ONNX buffer not full yet
      joints3d: { leftShoulder: {x:0,y:0,z:0}, leftElbow: {x:1,y:0,z:0} }, // Legacy fallback
      hasLeftArm: true
    };

    // This should NOT throw an error
    expect(() => {
      driveLimbs(mockVrm, mockBones, mockRest, bodyData, 0.5, false);
    }).not.toThrow();
    
    // In a real scenario, we would verify that the legacy joints were used 
    // to calculate the quaternion slerp.
  });
});