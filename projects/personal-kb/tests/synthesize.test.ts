import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ingest/extractors.js', () => ({
  extractFromUrl: vi.fn(async () => ({
    source: {
      type: 'article',
      title: 'Test Article',
      text: 'Placeholder.',
      extractionMethod: 'web_fetch',
      extractionConfidence: 0.88
    },
    related: []
  }))
}));

vi.mock('../src/retrieval/embeddings.js', () => ({
  embedText: vi.fn(async () => [0.1, 0.2, 0.3]),
  cosineSimilarity: vi.fn(() => 0.85)
}));

describe('answer synthesis', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('deduplicates overlapping chunks into distinct bullets', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    // Two chunks with heavily overlapping text (simulates overlapping chunking)
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Offer Page',
        text: 'Our main offer is the Growth Accelerator program. It includes weekly coaching calls and a private community. The program costs $2,000 per month. Our main offer is the Growth Accelerator program. It includes weekly coaching calls.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.9
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/offers');

    const answer = await answerQuestion(ctx, 'what is the main offer?');

    // Should have Answer section
    expect(answer).toContain('Answer:');

    // Count bullets (lines starting with "- ")
    const bullets = answer.split('\n').filter((l) => l.startsWith('- '));
    // Should not have duplicate bullets for overlapping content
    const bulletTexts = bullets.map((b) => b.toLowerCase());
    const uniqueBullets = new Set(bulletTexts);
    expect(uniqueBullets.size).toBe(bulletTexts.length);
  });

  it('offer-structure question produces structured sections', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Standard Playbook Offers',
        text: 'The Boardroom is our flagship community for agency owners scaling past $10k/mo, priced at $297/mo. The Directive is our high-touch consulting engagement for established teams at $5,000. Apply for The Directive today. Join The Boardroom now.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.95
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://standardplaybook.com/offers');

    const answer = await answerQuestion(ctx, 'what is our main offer structure and pricing?');

    expect(answer).toContain('Offer structure:');
    const lines = answer.split('\n');
    const offerIdx = lines.findIndex((l) => l.includes('Offer structure:'));
    expect(offerIdx).toBeGreaterThanOrEqual(0);
    expect(lines[offerIdx + 1]).toMatch(/^- /);
  });

  it('output contains no huge raw chunk dumps (each bullet <= 200 chars)', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    const longText = 'This is a sentence about business strategy and growth. '.repeat(20);
    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Long Article',
        text: longText,
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/long');

    const answer = await answerQuestion(ctx, 'what is the business strategy?');
    const bullets = answer.split('\n').filter((l) => l.startsWith('- '));

    for (const bullet of bullets) {
      // "- " prefix + text + possible citation " [1]" = generous 200 char check
      expect(bullet.length).toBeLessThanOrEqual(200);
    }
  });

  it('citations and retrieval context still present', async () => {
    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/cite-test');

    const answer = await answerQuestion(ctx, 'test question');

    expect(answer).toContain('Answer:');
    expect(answer).toContain('Citations:');
    expect(answer).toContain('Retrieval context:');
    expect(answer).toContain('Filters: none');
    expect(answer).toContain('Candidate chunks:');
    expect(answer).toContain('Candidate sources:');
    expect(answer).toContain('Returned:');
    // Should have at least one citation with URL
    expect(answer).toMatch(/\[\d+\]/);
    expect(answer).toContain('example.com');
  });

  it('backward compatibility: non-offer question returns general bullets', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'General Article',
        text: 'The team focused on improving customer retention through better onboarding. They implemented a 14-day email sequence. Results showed a 23% improvement in activation rates.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/general');

    const answer = await answerQuestion(ctx, 'how did we improve retention?');

    expect(answer).toContain('Answer:');
    // Should NOT have structured sections for a non-offer question
    expect(answer).not.toContain('Offer structure:');
    expect(answer).not.toContain('CTA flow:');
    // Should have bullets
    const bullets = answer.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(6);
  });
});

describe('structured offer extraction', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('offer query returns canonical offers when present', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Our Offers',
        text: [
          'The Boardroom is our flagship community for agency owners, priced at $297/mo.',
          'The 8 Week Experience is designed for teams who want rapid transformation at $1,997.',
          'The Directive is our premium consulting tier for established businesses at $5,000.',
          'The 6 Week Producer Challenge helps new producers build their pipeline at $497.',
          'Book a discovery call to find the right fit.'
        ].join(' '),
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.92
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/plans');

    const answer = await answerQuestion(ctx, 'what are our offer tiers and pricing?');

    expect(answer).toContain('Offer structure:');

    const lines = answer.split('\n');
    const offerStart = lines.findIndex((l) => l.includes('Offer structure:'));
    const offerBullets: string[] = [];
    for (let i = offerStart + 1; i < lines.length; i++) {
      if (lines[i].startsWith('- ')) offerBullets.push(lines[i]);
      else if (lines[i].trim() !== '') break;
    }

    expect(offerBullets.length).toBeGreaterThanOrEqual(3);

    const allOfferText = offerBullets.join(' ').toLowerCase();
    const foundNames = ['boardroom', 'directive', '8 week', 'producer challenge'].filter((n) => allOfferText.includes(n));
    expect(foundNames.length).toBeGreaterThanOrEqual(3);
  });

  it('pricing only shown when explicitly found in text', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Services',
        text: [
          'The Coaching Program helps agency owners grow their business.',
          'The Audit Service reviews your current offer stack.',
          'The Done-For-You Package includes full implementation at $3,500.'
        ].join(' '),
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/services');

    const answer = await answerQuestion(ctx, 'what are the pricing plans?');

    // Price should appear for the DFY package
    expect(answer).toMatch(/\$3,500/);

    // Offers without prices should NOT fabricate a price
    const lines = answer.split('\n').filter((l) => l.startsWith('- '));
    for (const line of lines) {
      // If a bullet mentions "Coaching" or "Audit", it should NOT have a $ amount
      if (/coaching/i.test(line) && !/done.for.you/i.test(line)) {
        expect(line).not.toMatch(/\$\d/);
      }
    }
  });

  it('no long blob bullets in offer output', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    const blobText = [
      'The Boardroom is our flagship community for agency owners, at $297/mo.',
      'The Directive is our consulting tier for established businesses at $5,000.',
      'Join The Boardroom today.',
      'We also provide various resources and training materials.',
      'Menu Home About Contact Privacy Footer Navigation Skip to content Copyright 2024'
    ].join(' ');

    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Offers',
        text: blobText,
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/blob');

    const answer = await answerQuestion(ctx, 'what is the offer structure?');

    const bullets = answer.split('\n').filter((l) => l.startsWith('- '));
    for (const bullet of bullets) {
      expect(bullet.length).toBeLessThanOrEqual(200);
    }

    expect(answer).toContain('Offer structure:');
    expect(answer).toContain('Citations:');
  });
});

describe('section-aware noise filtering', () => {
  it('filterNoisyChunks removes chunks from nav/hero/footer sections', async () => {
    const { filterNoisyChunks } = await import('../src/retrieval/synthesize.js');

    const chunks = [
      { section_title: 'Navigation', text: 'Home About Contact' },
      { section_title: 'Hero', text: 'Welcome to our site' },
      { section_title: 'Our Services', text: 'We offer coaching and consulting.' },
      { section_title: 'Footer', text: 'Copyright 2024' },
      { section_title: null, text: 'Some content without a section.' }
    ] as any[];

    const filtered = filterNoisyChunks(chunks);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].section_title).toBe('Our Services');
    expect(filtered[1].section_title).toBeNull();
  });

  it('extractStructuredOffers groups by section_title with canonical names', async () => {
    const { extractStructuredOffers } = await import('../src/retrieval/synthesize.js');

    const chunks = [
      { section_title: 'The Boardroom', text: 'The Boardroom is designed for agency owners scaling past $10k/mo, priced at $297/mo. Join The Boardroom today.', source_id: 1, final_score: 0.9 },
      { section_title: 'The Directive', text: 'The Directive is our high-touch consulting for established teams at $5,000. Apply for The Directive.', source_id: 1, final_score: 0.85 }
    ] as any[];

    const offers = extractStructuredOffers(chunks);
    expect(offers.length).toBe(2);

    const names = offers.map((o: any) => o.offer_name);
    expect(names).toContain('The Boardroom');
    expect(names).toContain('The Directive');

    // Price should be section-locked
    const boardroom = offers.find((o: any) => o.offer_name === 'The Boardroom');
    expect(boardroom?.price).toMatch(/\$297/);

    const directive = offers.find((o: any) => o.offer_name === 'The Directive');
    expect(directive?.price).toMatch(/\$5,000/);
  });
});

describe('realistic noisy homepage extraction', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // Simulates a real homepage scrape with nav junk, carousel text, and mixed offer content
  const NOISY_HOMEPAGE = [
    'Skip to content Home About Services Contact Login',
    'Build Your Agency. Scale Your Revenue. Join 500+ agency owners.',
    'Featured in Forbes, Inc, and Entrepreneur Magazine.',
    'Featured in Forbes, Inc, and Entrepreneur Magazine.',  // duplicate carousel slide
    '',
    'The Boardroom is our flagship community for agency owners who want accountability and growth, at $297/mo.',
    'Join The Boardroom today.',
    '',
    'The 8 Week Experience is an intensive transformation program designed for teams ready to 10x their output, at $1,997.',
    'Apply for 8 Week Experience.',
    '',
    'The Directive is our premium 1-on-1 consulting engagement for established businesses doing $500k+ annually, at $5,000.',
    'Apply for Directive.',
    '',
    'The 6 Week Producer Challenge helps new producers build their first pipeline and close their first deals, at $497.',
    'Join the Producer Challenge.',
    '',
    'What Our Clients Say: "Best investment I ever made." — John D.',
    '"Transformed my agency in 90 days." — Sarah K.',
    'Home About Services Blog Contact Privacy Terms Copyright 2024 All Rights Reserved.',
  ].join('\n');

  it('each canonical offer extracted at most once', async () => {
    const { extractStructuredOffers, filterNoisyChunks } = await import('../src/retrieval/synthesize.js');

    // Simulate chunks from the noisy homepage (no section titles, all in one block)
    const chunks = [
      { section_title: null, text: NOISY_HOMEPAGE, source_id: 1, final_score: 0.85 }
    ] as any[];

    const filtered = filterNoisyChunks(chunks);
    const offers = extractStructuredOffers(filtered.length > 0 ? filtered : chunks);

    // Count occurrences of each canonical name
    const nameCounts = new Map<string, number>();
    for (const o of offers) {
      nameCounts.set(o.offer_name, (nameCounts.get(o.offer_name) || 0) + 1);
    }

    // Each canonical offer should appear at most once
    for (const [name, count] of nameCounts) {
      expect(count, `"${name}" appeared ${count} times`).toBe(1);
    }

    // Should find all 4 canonical offers
    const names = offers.map((o: any) => o.offer_name);
    expect(names).toContain('The Boardroom');
    expect(names).toContain('8 Week Experience');
    expect(names).toContain('The Directive');
    expect(names).toContain('6 Week Producer Challenge');
  });

  it('no cross-offer price contamination', async () => {
    const { extractStructuredOffers } = await import('../src/retrieval/synthesize.js');

    const chunks = [
      { section_title: null, text: NOISY_HOMEPAGE, source_id: 1, final_score: 0.85 }
    ] as any[];

    const offers = extractStructuredOffers(chunks);

    const boardroom = offers.find((o: any) => o.offer_name === 'The Boardroom');
    const experience = offers.find((o: any) => o.offer_name === '8 Week Experience');
    const directive = offers.find((o: any) => o.offer_name === 'The Directive');
    const challenge = offers.find((o: any) => o.offer_name === '6 Week Producer Challenge');

    // Boardroom should be $297/mo, NOT $1,997 or $5,000 or $497
    expect(boardroom?.price).toMatch(/\$297/);
    expect(boardroom?.price).not.toMatch(/1,997|5,000|497/);

    // 8 Week Experience should be $1,997
    expect(experience?.price).toMatch(/\$1,997/);

    // Directive should be $5,000 (not $500k which is a revenue figure)
    expect(directive?.price).toMatch(/\$5,000/);
    expect(directive?.price).not.toMatch(/500/);

    // Producer Challenge should be $497
    expect(challenge?.price).toMatch(/\$497/);
  });

  it('CTA strings are short and clean (2-7 words)', async () => {
    const { extractStructuredOffers } = await import('../src/retrieval/synthesize.js');

    const chunks = [
      { section_title: null, text: NOISY_HOMEPAGE, source_id: 1, final_score: 0.85 }
    ] as any[];

    const offers = extractStructuredOffers(chunks);

    for (const offer of offers) {
      if (offer.cta_text) {
        const wordCount = offer.cta_text.split(/\s+/).length;
        expect(wordCount, `CTA "${offer.cta_text}" for ${offer.offer_name} has ${wordCount} words`).toBeGreaterThanOrEqual(2);
        expect(wordCount, `CTA "${offer.cta_text}" for ${offer.offer_name} has ${wordCount} words`).toBeLessThanOrEqual(7);
        // Should not contain long sentence fragments
        expect(offer.cta_text.length).toBeLessThanOrEqual(50);
      }
    }
  });

  it('quality gate falls back on non-canonical offers with confidence warning', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Random Services',
        text: 'We offer Web Design starting at $999. We also offer SEO Audits at $299. Book a free call today.',
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://example.com/random');

    const answer = await answerQuestion(ctx, 'what are the pricing plans?');

    // Should NOT produce structured offer output (non-canonical)
    expect(answer).not.toContain('Offer structure:');
    // Should have confidence warning
    expect(answer).toContain('Could not confidently extract structured offers');
    // Should still have citations
    expect(answer).toContain('Citations:');
  });

  it('full integration: noisy homepage produces clean structured answer', async () => {
    const { extractFromUrl } = await import('../src/ingest/extractors.js');

    vi.mocked(extractFromUrl).mockResolvedValueOnce({
      source: {
        type: 'article',
        title: 'Standard Playbook',
        text: NOISY_HOMEPAGE,
        extractionMethod: 'web_fetch',
        extractionConfidence: 0.88
      },
      related: []
    });

    const { initDB } = await import('../src/db/client.js');
    const { ingestUrl } = await import('../src/ingest/pipeline.js');
    const { answerQuestion } = await import('../src/retrieval/search.js');

    const ctx = initDB(':memory:');
    await ingestUrl(ctx, 'https://standardplaybook.com');

    const answer = await answerQuestion(ctx, 'what is the offer structure and pricing?');

    expect(answer).toContain('Offer structure:');
    expect(answer).toContain('Boardroom');
    expect(answer).toContain('Directive');
    expect(answer).toContain('Citations:');
    expect(answer).toContain('Retrieval context:');

    // No bullet should contain nav/footer junk
    const bullets = answer.split('\n').filter((l) => l.startsWith('- '));
    for (const bullet of bullets) {
      expect(bullet).not.toMatch(/skip to content/i);
      expect(bullet).not.toMatch(/copyright/i);
      expect(bullet).not.toMatch(/all rights reserved/i);
      expect(bullet.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('synthesize unit tests', () => {
  it('cleanChunkText removes noise lines', async () => {
    const { cleanChunkText } = await import('../src/retrieval/synthesize.js');

    const noisy = 'Menu\nHome\nAbout\nSkip to content\nThis is the actual useful information about our product.\nCopyright 2024\nAll rights reserved';
    const cleaned = cleanChunkText(noisy);

    expect(cleaned).toContain('actual useful information');
    expect(cleaned).not.toMatch(/^menu/i);
    expect(cleaned).not.toMatch(/copyright/i);
  });

  it('deduplicateSpans removes overlapping text', async () => {
    const { deduplicateSpans } = await import('../src/retrieval/synthesize.js');

    const spans = [
      'Our main offer is the Growth Accelerator program.',
      'Our main offer is the Growth Accelerator program.',
      'The program includes coaching and community access.',
      'The program includes coaching and community access.'
    ];

    const deduped = deduplicateSpans(spans);
    expect(deduped).toHaveLength(2);
  });

  it('splitSentences handles abbreviations', async () => {
    const { splitSentences } = await import('../src/retrieval/synthesize.js');

    const text = 'Dr. Smith founded the company in 2020. The company grew to $1M ARR. It was impressive.';
    const sentences = splitSentences(text);

    // "Dr. Smith..." should not be split at "Dr."
    expect(sentences[0]).toContain('Dr. Smith');
    expect(sentences.length).toBeGreaterThanOrEqual(2);
  });

  it('truncateBullet respects max length', async () => {
    const { truncateBullet } = await import('../src/retrieval/synthesize.js');

    const long = 'This is a very long sentence that goes on and on about various topics including business strategy and growth hacking and customer acquisition and retention metrics and all sorts of things.';
    const truncated = truncateBullet(long, 80);

    expect(truncated.length).toBeLessThanOrEqual(83); // 80 + "..."
    expect(truncated).toMatch(/\.\.\.$/);
  });

  it('detectIntent classifies offer questions', async () => {
    const { detectIntent } = await import('../src/retrieval/synthesize.js');

    expect(detectIntent('what is our offer structure?')).toBe('offer_structure');
    expect(detectIntent('how much does the pricing tier cost?')).toBe('offer_structure');
    expect(detectIntent('what packages do we have?')).toBe('offer_structure');
    expect(detectIntent('how did we improve retention?')).toBe('general');
    expect(detectIntent('what is our team structure?')).toBe('general');
  });
});
