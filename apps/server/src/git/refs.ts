const SAFE_REF = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+(?<!\.lock)(?<![./])$/;

export function assertRefName(name: string) {
  if (!SAFE_REF.test(name)) throw new Error(`"${name}" is not a branch name Shinsa will pass to git.`);
  return name;
}

export function slugify(text: string, max = 40) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'task'
  );
}
