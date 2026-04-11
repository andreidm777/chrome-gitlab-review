#!/usr/bin/env python3
"""Generate simple PNG icons for the extension."""

import struct
import zlib
import os

def create_png_icon(size, output_path):
    """Create a simple PNG icon with the gradient and magnifying glass."""
    # For Chrome extensions, we can use a simple colored square with an icon
    # Since we can't use external libraries, create a minimal valid PNG
    
    # Create a minimal 1x1 pixel PNG as placeholder
    # Real icons would be created with proper image libraries
    
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk (image header)
    width = size
    height = size
    bit_depth = 8
    color_type = 6  # RGBA
    compression = 0
    filter_method = 0
    interlace = 0
    
    ihdr_data = struct.pack('>IIBBBBB', width, height, bit_depth, color_type, 
                            compression, filter_method, interlace)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    ihdr_chunk = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    
    # IDAT chunk (image data) - create gradient background with simple icon
    raw_data = b''
    
    center_x = size // 2
    center_y = size // 2
    radius = size // 3
    
    for y in range(height):
        raw_data += b'\x00'  # Filter byte
        for x in range(width):
            # Create gradient background
            r1 = int(102 + (118 - 102) * (x / width))
            g1 = int(126 + (75 - 126) * (x / width))
            b1 = int(234 + (162 - 234) * (x / width))
            
            # Check if pixel is within circle (icon area)
            dx = x - center_x
            dy = y - center_y
            dist = (dx * dx + dy * dy) ** 0.5
            
            if dist < radius:
                # Inside the circle - draw a simple magnifying glass
                # Background circle
                r2 = int(102 + (118 - 102) * (x / size))
                g2 = int(126 + (75 - 126) * (x / size))
                b2 = int(234 + (162 - 234) * (x / size))
                
                # Draw magnifying glass handle
                handle_x = center_x + int(radius * 0.6)
                handle_y = center_y + int(radius * 0.6)
                handle_dist = ((x - handle_x)**2 + (y - handle_y)**2)**0.5
                
                # Draw circle outline
                circle_thickness = max(3, size // 20)
                if abs(dist - radius * 0.7) < circle_thickness or handle_dist < circle_thickness:
                    raw_data += struct.pack('BBBB', 255, 255, 255, 255)  # White icon
                else:
                    raw_data += struct.pack('BBBB', r2, g2, b2, 255)
            else:
                # Gradient background
                raw_data += struct.pack('BBBB', r1, g1, b1, 255)
    
    compressed_data = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + compressed_data) & 0xffffffff
    idat_chunk = struct.pack('>I', len(compressed_data)) + b'IDAT' + compressed_data + struct.pack('>I', idat_crc)
    
    # IEND chunk (image end)
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    iend_chunk = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
    
    # Write PNG file
    with open(output_path, 'wb') as f:
        f.write(signature + ihdr_chunk + idat_chunk + iend_chunk)
    
    print(f"Created {output_path} ({size}x{size})")

# Create icons
icon_sizes = [16, 48, 128]
output_dir = os.path.dirname(os.path.abspath(__file__))

for size in icon_sizes:
    output_path = os.path.join(output_dir, f'icon{size}.png')
    create_png_icon(size, output_path)

print("All icons generated successfully!")
