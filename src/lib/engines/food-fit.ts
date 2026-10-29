/**
 * Is this a food creator? Creator databases match anyone who posted a spicy video once, so the list
 * mixes food creators with beauty, mom-life and gaming accounts. Read the name, handles, bios and
 * captions: any food signal makes them a food creator; other topics with no food signal rule them out;
 * nothing to go on is unknown.
 */
export type FoodFit = { fit: "food" | "not_food" | "unknown"; reason: string };

// Whole words in bios, names and captions.
const FOOD_WORDS =
  /\b(food(s|ie|ies)?|eat(s|ing|er|ers)?|hungry|bites?|kitchen|chefs?|cook(s|ing|er)?|recipes?|mukbangs?|spic(y|e|es)|hot ?sauces?|munch(ies|ing)?|yum(my)?|snacks?|taste ?tests?|tasting|bbq|barbecue|grill(ing|master)?|noodles?|ramen|wings|sauces?|bak(e|es|ing|er|ery)|meals?|meal ?prep|dinners?|lunch|brunch|restaurants?|delicious|delish|cuisine|foodporn|eatery|tacos?|pizza|burgers?|sushi|dessert|desserts|baking|culinary|flavou?rs?|seasonings?|asmr ?eating|what i eat|eatz|plates?|tastes?|noms?|gorge|cocina|cocinando|comida)\b/i;
// Inside handles, where words run together ("eatwithaana", "hungriwitvivi", "bitesbydanielle").
const FOOD_IN_HANDLE =
  /(eats|eatz|eatwith|eatthat|willeat|eating|letseat|nomwith|flavor|food|hungr|hangry|bites|kitchen|chef|cook|recipe|mukbang|spicy|munch|yum|snack|taste|tasty|bbq|grill|noodle|ramen|sauce|bake|meal|chow|grub|feast|delish|nomnom|crave|plate|fork|spoon|kusina|comida|cocina)/i;
const FOOD_EMOJI = /🍜|🌶|🍕|🍔|🌮|🍣|🍗|🥘|🍽|🍳|🧑‍🍳|👩‍🍳|👨‍🍳|🍲|🥟|🍝|🌯|🥩|🍤|🥡|🍱|🥢|🍴|🍟|🌭|🥪|🫕|🍛|🧂|🥵|🍖|🍰|🧁|🍩/u;

const OTHER_TOPICS =
  /\b(beauty|skin ?care|make ?up|make-up|moda|loctician|models?|modeling|hair|wigs?|lash(es)?|nails?|fashion|outfits?|ootd|styl(e|ist|ing)|fitness|gym|workouts?|gaming|gamer|plants?|garden(er|ing)?|mom|moms|mommy|mama|boy ?mom|girl ?mom|wife|travel(s|ing|er)?|tech|cars?|pets?|dog ?mom|cat ?mom|dance|dancer|music|singer|artist|books?|booktok|cosplay|comedy|skits?|crafts?|diy|home ?decor|cleaning|thrift(ing)?|tt ?shop|lifestyle|vlogs?|faith|nurse|nursing|teacher|student|college|uni|engineering|clothes|momma|motherhood|toddler|stand ?up|comedian|twitch|streamer|streaming|skateboard(er|ing)?)\b/i;
// Other topics inside handles ("williebeecomedy", "luuglowdiary").
const OTHER_IN_HANDLE = /(beauty|glam|glow|makeup|hair|nails|lash|fashion|skincare|gaming|gamer|comedy|plant|garden|momlife|mommy|travel)/i;

export function foodFit(p: { name: string; handles: string[]; bios: string[]; captions?: string[] }): FoodFit {
  const text = [p.name, ...p.bios, ...(p.captions ?? [])].join("\n");
  const word = text.match(FOOD_WORDS)?.[0];
  if (word) return { fit: "food", reason: `mentions "${word.toLowerCase()}"` };
  const handle = p.handles.find((h) => FOOD_IN_HANDLE.test(h));
  if (handle) return { fit: "food", reason: `handle @${handle.replace(/^@/, "")}` };
  // A 🌶️ next to "music artist" is a personality, not a niche: emoji only count when nothing else is stated.
  const other = text.match(OTHER_TOPICS)?.[0] ?? p.handles.map((h) => h.match(OTHER_IN_HANDLE)?.[0]).find(Boolean);
  if (other) return { fit: "not_food", reason: `posts about ${other.toLowerCase()}, no food` };
  const emoji = text.match(FOOD_EMOJI)?.[0];
  if (emoji) return { fit: "food", reason: `food emoji ${emoji}` };
  return { fit: "unknown", reason: "nothing in their name or bio says" };
}
