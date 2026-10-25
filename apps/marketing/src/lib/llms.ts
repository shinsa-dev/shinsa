import { closing, features, hero, principles, sections } from './content.ts';
import { site } from './site.ts';

export function serializeLlms() {
  return [
    `# ${site.name}`,
    '',
    `> ${site.description}`,
    '',
    hero.text,
    '',
    ...Object.values(sections).flatMap((section) => [`## ${section.title}`, '', section.text, '']),
    '## Principles',
    '',
    ...principles.map((principle) => `- **${principle.title}**: ${principle.text}`),
    '',
    '## Details',
    '',
    ...features.map((feature) => `- **${feature.title}**: ${feature.text}`),
    '',
    `${closing.title} ${closing.text}`,
    '',
    '## Links',
    '',
    `- [Website](${site.url})`,
    `- [Source code](${site.githubUrl})`,
    `- [Download for Mac](${site.downloadUrl})`,
    '',
  ].join('\n');
}
