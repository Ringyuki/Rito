/**
 * How much of the sky a sheet in the air hides from each point of the
 * pages, for the light of the room: the two ways a sheet stands off them.
 * Both are part of the shader that works the shadows out, which has `vAt`,
 * `uSize`, `uSpine`, `uSpineAt`, `uGutter`, `uLight`, `uProfile`, `uRoll`
 * and `withBounces`.
 */

/**
 * A leaf swung about the spine. Each row of it is taken as a strip running
 * the height of the page, bound at the spine, and what it hides from a
 * point is everything between the horizon on the spine's side and the
 * farthest over the point it reaches: by the spine on the open side that is
 * the slope the leaf leaves it at, far off it is the leaf's outer edge, and
 * under the leaf it is all but what shows past that edge. The page under a
 * leaf is in its shade like any other, and is in sight wherever the leaf
 * leans toward the eye. A bent leaf ends short of the page's top and
 * bottom, and a point past its end is not under it: the leaf hides from it
 * no more than from a point at its very edge, half the sky, and less the
 * farther past the end it lies for how high the end stands.
 *
 * And by the spine, the leaf's own shade. The pages of a book are bound
 * together: the page beside a standing leaf rises to meet it at the spine
 * and is lit there as the foot of the leaf is, so the leaf's shade runs on
 * across the spine and fades into the page instead of stopping at a line.
 */
export const LEAF_SKY = `
// One stretch of an end of the leaf, and a point of the page. Where the stretch passes over the
// point's place across the page: how far down the page the point is from it (x), how high it
// stands there (y), and 1. What was found before is kept if it is nearer; its z is below zero for none.
vec3 nearer(vec3 found, vec2 point, vec3 from, vec3 to, float down) {
  float span = to.x - from.x;
  if (abs(span) < 0.001) return found;
  float t = (point.x - from.x) / span;
  if (t < 0.0 || t > 1.0) return found;
  vec3 over = mix(from, to, t);
  float past = down * (point.y - over.y);
  return found.z < 0.0 || past < found.x ? vec3(past, max(over.z, 0.0), 1.0) : found;
}

// The same for a whole end, which runs from the spine at foot out through four points of the leaf.
vec3 pastEnd(vec2 point, vec3 foot, vec3 a, vec3 b, vec3 c, vec3 d, float down) {
  vec3 found = vec3(0.0, 0.0, -1.0);
  found = nearer(found, point, foot, a, down);
  found = nearer(found, point, a, b, down);
  found = nearer(found, point, b, c, down);
  return nearer(found, point, c, d, down);
}

// What is left of the sky a leaf hides from a point that lies beyond an end of it, by how far
// (x) for how high the end stands (y); nothing changes where the point lies within the leaf's ends.
float pastTheEnd(float hidden, vec3 past) {
  if (past.z < 0.0 || past.x <= 0.0) return hidden;
  return min(hidden, 0.5) * (1.0 - past.x / length(past.xy));
}

float hiddenSky(vec2 point) {
  float along = clamp(point.y / uSize.y, 0.0, 1.0) * 7.0;
  // How far over the point the leaf reaches, from the horizon on the left and from the one on the right.
  float lowestLeft = 3.1415927;
  float highestRight = 0.0;
  for (int column = 0; column < 4; column++) {
    vec3 paper = vec3(0.0);
    for (int row = 0; row < 8; row++) {
      paper += uProfile[row * 4 + column] * clamp(1.0 - abs(along - float(row)), 0.0, 1.0);
    }
    float toPaper = atan(max(paper.z, 0.0), paper.x - point.x);
    lowestLeft = min(lowestLeft, toPaper);
    highestRight = max(highestRight, toPaper);
  }
  // The leaf rises from the spine, so that is the side it hides the sky from, hanging over the point or not.
  float hidden = vAt.x > uSpineAt ? 0.5 * (1.0 + cos(lowestLeft)) : 0.5 * (1.0 - cos(highestRight));
  vec3 top = vec3(uSpine, 0.0, 0.0);
  vec3 bottom = vec3(uSpine, uSize.y, 0.0);
  hidden = pastTheEnd(hidden, pastEnd(point, top, uProfile[0], uProfile[1], uProfile[2], uProfile[3], -1.0));
  return pastTheEnd(
    hidden,
    pastEnd(point, bottom, uProfile[28], uProfile[29], uProfile[30], uProfile[31], 1.0)
  );
}

// The light on a face of the leaf by the spine that looks that way across and up, lit as the leaf itself is.
float lightOn(vec2 facing) {
  float square = (facing.x * uLight.x + facing.y * uLight.z) / uLight.z;
  float lamp = max(square, 0.0) + uThrough * max(-square, 0.0);
  return min(uKeyShare * lamp + (1.0 - uKeyShare) * withBounces(0.5 + 0.5 * facing.y), 1.0);
}

float byTheSpine(vec2 point) {
  float along = clamp(point.y / uSize.y, 0.0, 1.0) * 7.0;
  vec3 foot = vec3(0.0);
  for (int row = 0; row < 8; row++) {
    foot += uProfile[row * 4] * clamp(1.0 - abs(along - float(row)), 0.0, 1.0);
  }
  // How the leaf leaves the spine: across and up.
  vec2 rise = vec2(foot.x - uSpine, max(foot.z, 0.0));
  float reach = length(rise);
  if (reach < 0.0001) return 0.0;
  rise /= reach;
  // The face of the leaf the reader sees, and the face that looks at this side of the spine.
  // They are one unless the leaf leans over this side, and then the page is out of sight
  // under it until the leaf stands nearly upright.
  vec2 seen = rise.x >= 0.0 ? vec2(-rise.y, rise.x) : vec2(rise.y, -rise.x);
  vec2 beside = point.x < uSpine ? vec2(-rise.y, rise.x) : vec2(rise.y, -rise.x);
  float lit = mix(lightOn(seen), lightOn(beside), smoothstep(0.8, 1.0, rise.y));
  return (1.0 - lit) * exp(-abs(point.x - uSpine) / uGutter);
}
`;

/**
 * A page curled over. Across the line it leaves the page at it is the same
 * all along: a roll touching the page at that line, and past half a turn
 * the paper lying flat on top of it, back the way it came. `uRoll` is the
 * direction across the page it is rolled back from (xy), where that line
 * lies along it (z) and the radius of the roll (w).
 *
 * On the side the roll is on, a point sees it as a circle standing on the
 * page: it hides the sky up to the line that just clears it, or up to where
 * the paper ends if it ends short of that. On the other side the paper
 * lying on top is a roof: a point under it sees the sky only past the
 * roof's edge, and one beyond that edge loses what the edge stands in front
 * of. Where the paper ends is where the page does, along that direction.
 */
export const ROLL_SKY = `
// How far the paper reaches past the line it leaves the page at, through a point of the page
// that lies s past that line.
float pastTheLine(vec2 point, float s) {
  vec2 d = uRoll.xy;
  float reach = (uSize.x - point.x) / max(d.x, 0.0001);
  if (d.y > 0.0001) reach = min(reach, (uSize.y - point.y) / d.y);
  if (d.y < -0.0001) reach = min(reach, -point.y / d.y);
  return reach + s;
}

float hiddenByRoll(vec2 point) {
  float r = uRoll.w;
  float s = dot(point, uRoll.xy) - uRoll.z;
  float paper = pastTheLine(point, s);
  if (paper <= 0.0 || r <= 0.0) return 0.0;
  // How far round the roll the paper goes, and where it is when it ends there: along, and up.
  float turn = min(3.1415927, paper / r);
  vec2 end = r * vec2(sin(turn), 1.0 - cos(turn));
  if (s > 0.0) {
    // The line that just clears the roll touches it this far round.
    if (2.0 * atan(s / r) <= turn) return r * r / (s * s + r * r);
    return 0.5 * (1.0 + cos(atan(end.y, end.x - s)));
  }
  float over = paper - 3.1415927 * r;
  vec2 edge = over > 0.0 ? vec2(-over, 2.0 * r) : end;
  return 0.5 * (1.0 - cos(atan(edge.y, edge.x - s)));
}
`;
