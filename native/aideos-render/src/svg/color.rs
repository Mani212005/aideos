//! File Description: CSS colour parsing for SVG paint and the Render IR: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` with numbers or percentages, `transparent` and the CSS named colours. Anything else is refused rather than guessed.
//! Inputs and outputs: a colour string -> straight (unpremultiplied) RGBA as four f32 channels in [0, 1], or None.
//! Used by: crate::svg (fill, stroke, stop-color) and crate::raster (IR colours).

/// A straight-alpha RGBA colour with channels in [0, 1].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Rgba {
    /// Builds a colour from 8-bit channels.
    pub fn from_u8(r: u8, g: u8, b: u8, a: u8) -> Rgba {
        Rgba {
            r: f32::from(r) / 255.0,
            g: f32::from(g) / 255.0,
            b: f32::from(b) / 255.0,
            a: f32::from(a) / 255.0,
        }
    }

    /// The same colour with its alpha multiplied by `k`.
    pub fn with_alpha_scaled(self, k: f64) -> Rgba {
        Rgba {
            a: (f64::from(self.a) * k).clamp(0.0, 1.0) as f32,
            ..self
        }
    }
}

/// The CSS named colours (CSS Color Level 4), as 0xRRGGBB.
const NAMED: &[(&str, u32)] = &[
    ("aliceblue", 0xF0F8FF),
    ("antiquewhite", 0xFAEBD7),
    ("aqua", 0x00FFFF),
    ("aquamarine", 0x7FFFD4),
    ("azure", 0xF0FFFF),
    ("beige", 0xF5F5DC),
    ("bisque", 0xFFE4C4),
    ("black", 0x000000),
    ("blanchedalmond", 0xFFEBCD),
    ("blue", 0x0000FF),
    ("blueviolet", 0x8A2BE2),
    ("brown", 0xA52A2A),
    ("burlywood", 0xDEB887),
    ("cadetblue", 0x5F9EA0),
    ("chartreuse", 0x7FFF00),
    ("chocolate", 0xD2691E),
    ("coral", 0xFF7F50),
    ("cornflowerblue", 0x6495ED),
    ("cornsilk", 0xFFF8DC),
    ("crimson", 0xDC143C),
    ("cyan", 0x00FFFF),
    ("darkblue", 0x00008B),
    ("darkcyan", 0x008B8B),
    ("darkgoldenrod", 0xB8860B),
    ("darkgray", 0xA9A9A9),
    ("darkgreen", 0x006400),
    ("darkgrey", 0xA9A9A9),
    ("darkkhaki", 0xBDB76B),
    ("darkmagenta", 0x8B008B),
    ("darkolivegreen", 0x556B2F),
    ("darkorange", 0xFF8C00),
    ("darkorchid", 0x9932CC),
    ("darkred", 0x8B0000),
    ("darksalmon", 0xE9967A),
    ("darkseagreen", 0x8FBC8F),
    ("darkslateblue", 0x483D8B),
    ("darkslategray", 0x2F4F4F),
    ("darkslategrey", 0x2F4F4F),
    ("darkturquoise", 0x00CED1),
    ("darkviolet", 0x9400D3),
    ("deeppink", 0xFF1493),
    ("deepskyblue", 0x00BFFF),
    ("dimgray", 0x696969),
    ("dimgrey", 0x696969),
    ("dodgerblue", 0x1E90FF),
    ("firebrick", 0xB22222),
    ("floralwhite", 0xFFFAF0),
    ("forestgreen", 0x228B22),
    ("fuchsia", 0xFF00FF),
    ("gainsboro", 0xDCDCDC),
    ("ghostwhite", 0xF8F8FF),
    ("gold", 0xFFD700),
    ("goldenrod", 0xDAA520),
    ("gray", 0x808080),
    ("green", 0x008000),
    ("greenyellow", 0xADFF2F),
    ("grey", 0x808080),
    ("honeydew", 0xF0FFF0),
    ("hotpink", 0xFF69B4),
    ("indianred", 0xCD5C5C),
    ("indigo", 0x4B0082),
    ("ivory", 0xFFFFF0),
    ("khaki", 0xF0E68C),
    ("lavender", 0xE6E6FA),
    ("lavenderblush", 0xFFF0F5),
    ("lawngreen", 0x7CFC00),
    ("lemonchiffon", 0xFFFACD),
    ("lightblue", 0xADD8E6),
    ("lightcoral", 0xF08080),
    ("lightcyan", 0xE0FFFF),
    ("lightgoldenrodyellow", 0xFAFAD2),
    ("lightgray", 0xD3D3D3),
    ("lightgreen", 0x90EE90),
    ("lightgrey", 0xD3D3D3),
    ("lightpink", 0xFFB6C1),
    ("lightsalmon", 0xFFA07A),
    ("lightseagreen", 0x20B2AA),
    ("lightskyblue", 0x87CEFA),
    ("lightslategray", 0x778899),
    ("lightslategrey", 0x778899),
    ("lightsteelblue", 0xB0C4DE),
    ("lightyellow", 0xFFFFE0),
    ("lime", 0x00FF00),
    ("limegreen", 0x32CD32),
    ("linen", 0xFAF0E6),
    ("magenta", 0xFF00FF),
    ("maroon", 0x800000),
    ("mediumaquamarine", 0x66CDAA),
    ("mediumblue", 0x0000CD),
    ("mediumorchid", 0xBA55D3),
    ("mediumpurple", 0x9370DB),
    ("mediumseagreen", 0x3CB371),
    ("mediumslateblue", 0x7B68EE),
    ("mediumspringgreen", 0x00FA9A),
    ("mediumturquoise", 0x48D1CC),
    ("mediumvioletred", 0xC71585),
    ("midnightblue", 0x191970),
    ("mintcream", 0xF5FFFA),
    ("mistyrose", 0xFFE4E1),
    ("moccasin", 0xFFE4B5),
    ("navajowhite", 0xFFDEAD),
    ("navy", 0x000080),
    ("oldlace", 0xFDF5E6),
    ("olive", 0x808000),
    ("olivedrab", 0x6B8E23),
    ("orange", 0xFFA500),
    ("orangered", 0xFF4500),
    ("orchid", 0xDA70D6),
    ("palegoldenrod", 0xEEE8AA),
    ("palegreen", 0x98FB98),
    ("paleturquoise", 0xAFEEEE),
    ("palevioletred", 0xDB7093),
    ("papayawhip", 0xFFEFD5),
    ("peachpuff", 0xFFDAB9),
    ("peru", 0xCD853F),
    ("pink", 0xFFC0CB),
    ("plum", 0xDDA0DD),
    ("powderblue", 0xB0E0E6),
    ("purple", 0x800080),
    ("rebeccapurple", 0x663399),
    ("red", 0xFF0000),
    ("rosybrown", 0xBC8F8F),
    ("royalblue", 0x4169E1),
    ("saddlebrown", 0x8B4513),
    ("salmon", 0xFA8072),
    ("sandybrown", 0xF4A460),
    ("seagreen", 0x2E8B57),
    ("seashell", 0xFFF5EE),
    ("sienna", 0xA0522D),
    ("silver", 0xC0C0C0),
    ("skyblue", 0x87CEEB),
    ("slateblue", 0x6A5ACD),
    ("slategray", 0x708090),
    ("slategrey", 0x708090),
    ("snow", 0xFFFAFA),
    ("springgreen", 0x00FF7F),
    ("steelblue", 0x4682B4),
    ("tan", 0xD2B48C),
    ("teal", 0x008080),
    ("thistle", 0xD8BFD8),
    ("tomato", 0xFF6347),
    ("turquoise", 0x40E0D0),
    ("violet", 0xEE82EE),
    ("wheat", 0xF5DEB3),
    ("white", 0xFFFFFF),
    ("whitesmoke", 0xF5F5F5),
    ("yellow", 0xFFFF00),
    ("yellowgreen", 0x9ACD32),
];

/// Reads one hex digit pair, or a single digit doubled when `short`.
fn hex_channel(s: &str, i: usize, short: bool) -> Option<u8> {
    if short {
        let d = u8::from_str_radix(&s[i..i + 1], 16).ok()?;
        Some(d * 17)
    } else {
        u8::from_str_radix(&s[i..i + 2], 16).ok()
    }
}

/// Parses `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
fn parse_hex(hex: &str) -> Option<Rgba> {
    if !hex.is_ascii() {
        return None;
    }
    let (short, n) = match hex.len() {
        3 | 4 => (true, hex.len()),
        6 | 8 => (false, hex.len() / 2),
        _ => return None,
    };
    let step = if short { 1 } else { 2 };
    let r = hex_channel(hex, 0, short)?;
    let g = hex_channel(hex, step, short)?;
    let b = hex_channel(hex, 2 * step, short)?;
    let a = if n == 4 {
        hex_channel(hex, 3 * step, short)?
    } else {
        255
    };
    Some(Rgba::from_u8(r, g, b, a))
}

/// Parses one `rgb()` channel: a number 0 to 255 or a percentage.
fn rgb_channel(s: &str) -> Option<f32> {
    let s = s.trim();
    if let Some(p) = s.strip_suffix('%') {
        return Some((p.trim().parse::<f32>().ok()? / 100.0).clamp(0.0, 1.0));
    }
    Some((s.parse::<f32>().ok()? / 255.0).clamp(0.0, 1.0))
}

/// Parses an alpha component: a number 0 to 1 or a percentage.
fn alpha_channel(s: &str) -> Option<f32> {
    let s = s.trim();
    if let Some(p) = s.strip_suffix('%') {
        return Some((p.trim().parse::<f32>().ok()? / 100.0).clamp(0.0, 1.0));
    }
    Some(s.parse::<f32>().ok()?.clamp(0.0, 1.0))
}

/// Parses `rgb(r, g, b)`, `rgba(r, g, b, a)` and the space-separated `rgb(r g b / a)` form.
fn parse_rgb_function(body: &str) -> Option<Rgba> {
    let (channels, alpha) = match body.split_once('/') {
        Some((c, a)) => (c, Some(a)),
        None => (body, None),
    };
    let parts: Vec<&str> = if channels.contains(',') {
        channels.split(',').collect()
    } else {
        channels.split_whitespace().collect()
    };
    let (rgb, alpha) = match (parts.len(), alpha) {
        (3, a) => (&parts[..3], a),
        (4, None) => (&parts[..3], Some(parts[3])),
        _ => return None,
    };
    Some(Rgba {
        r: rgb_channel(rgb[0])?,
        g: rgb_channel(rgb[1])?,
        b: rgb_channel(rgb[2])?,
        a: match alpha {
            Some(a) => alpha_channel(a)?,
            None => 1.0,
        },
    })
}

/// Parses a CSS colour, or None when the string is not one this renderer supports.
pub fn parse_color(input: &str) -> Option<Rgba> {
    let s = input.trim();
    if let Some(hex) = s.strip_prefix('#') {
        return parse_hex(hex);
    }
    let lower = s.to_ascii_lowercase();
    if let Some(body) = lower
        .strip_prefix("rgba(")
        .or_else(|| lower.strip_prefix("rgb("))
    {
        return parse_rgb_function(body.strip_suffix(')')?);
    }
    if lower == "transparent" {
        return Some(Rgba {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 0.0,
        });
    }
    NAMED.iter().find(|(name, _)| *name == lower).map(|(_, v)| {
        Rgba::from_u8(
            ((v >> 16) & 0xFF) as u8,
            ((v >> 8) & 0xFF) as u8,
            (v & 0xFF) as u8,
            255,
        )
    })
}
