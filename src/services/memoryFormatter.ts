import { MemorySearchResult } from './memoryClient';
import { ConfigInstruction } from './instructionClient';

/**
 * Build a "STRICT RULES" prefix from config instructions and instruction-category memories.
 * Prepended BEFORE the base system prompt. Returns '' when both sources are empty.
 */
export function buildInstructionPrefix(
    configInstructions: ConfigInstruction[],
    memories: MemorySearchResult[]
): string {
    const memoryInstructions = memories.filter(m => m.category === 'instruction');
    const all = [
        ...configInstructions.map(i => i.content),
        ...memoryInstructions.map(m => m.content),
    ];
    if (all.length === 0) return '';
    return `STRICT RULES (always follow):\n${all.map(c => `- ${c}`).join('\n')}\n\n`;
}

/**
 * Build organized knowledge sections from non-instruction memories.
 * Appended AFTER the base system prompt.
 *   - fact / context  →  "KNOWN FACTS"
 *   - persona / preference  →  "USER PROFILE"
 *   - neuralese memory_type  →  "NEURALESE_CONTEXT"
 * Returns '' when all buckets are empty.
 */
export function buildKnowledgeSuffix(memories: MemorySearchResult[]): string {
    const distilled = memories.filter(m => (m.memory_type ?? 'distilled') === 'distilled');
    const neuralese = memories.filter(m => m.memory_type === 'neuralese');

    const facts   = distilled.filter(m => m.category === 'fact' || m.category === 'context');
    const profile = distilled.filter(m => m.category === 'persona' || m.category === 'preference');

    const sections: string[] = [];
    if (facts.length > 0) {
        sections.push(`KNOWN FACTS:\n${facts.map(m => `- ${m.content}`).join('\n')}`);
    }
    if (profile.length > 0) {
        sections.push(`USER PROFILE:\n${profile.map(m => `- ${m.content}`).join('\n')}`);
    }
    if (neuralese.length > 0) {
        sections.push(
            `NEURALESE_CONTEXT:\n` +
            neuralese.map(m => `- ${m.content}`).join('\n')
        );
    }
    if (sections.length === 0) return '';
    return '\n\n' + sections.join('\n\n');
}
