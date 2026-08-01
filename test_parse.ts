import { shotSchema } from "./src/dl/schema";

const res = shotSchema.safeParse({
  id: "test",
  dur: 5,
  look: "all",
  scriptText: "Hello world"
});

console.log(res.success ? res.data : res.error);
