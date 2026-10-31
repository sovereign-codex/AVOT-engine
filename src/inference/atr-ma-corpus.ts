export interface ATRReasoningEdge {
  from: string;
  relation: string;
  to: string;
}

export interface ATRPassageRecord {
  record_id: string;
  lineage_id: string;
  work: string;
  locator: string;
  source_tier: string;
  translation: string;
  source_url: string;
  anchor_text: string;
  paraphrase: string;
  concepts: string[];
  reasoning_edges: ATRReasoningEdge[];
  default_inference_ceiling: "A" | "B" | "C" | "D" | "E";
  temporal_boundary: string;
  uncertainty: string;
  contradiction_links: string[];
  notes: string;
}

export const MA_CORPUS_0001: readonly ATRPassageRecord[] = [
  {
    record_id: "MA-MED-02-01",
    lineage_id: "MA-001",
    work: "Meditations",
    locator: "2.1",
    source_tier: "T1_PRIMARY_TRANSLATION",
    translation: "Meric Casaubon",
    source_url: "https://www.gutenberg.org/files/2680/2680-h/2680-h.htm",
    anchor_text: "Betimes in the morning say to thyself",
    paraphrase: "Anticipate difficult people without hatred, because their faults arise from mistaken judgments about good and evil; human beings are made for cooperation.",
    concepts: ["social_cooperation", "moral_error", "preparation", "non_retaliation", "shared_rational_nature"],
    reasoning_edges: [
      { from: "wrongdoing", relation: "often_arises_from", to: "ignorance_about_good_and_evil" },
      { from: "shared_human_nature", relation: "supports", to: "cooperation" },
      { from: "anticipated_friction", relation: "should_not_require", to: "hatred" },
    ],
    default_inference_ceiling: "B",
    temporal_boundary: "ancient_roman_context",
    uncertainty: "Low for core ethical structure; translation wording varies.",
    contradiction_links: [],
    notes: "Useful for evaluating reconstructions involving conflict, social duty, and charitable interpretation of others.",
  },
  {
    record_id: "MA-MED-05-01",
    lineage_id: "MA-001",
    work: "Meditations",
    locator: "5.1",
    source_tier: "T1_PRIMARY_TRANSLATION",
    translation: "Meric Casaubon",
    source_url: "https://www.gutenberg.org/files/2680/2680-h/2680-h.htm",
    anchor_text: "it is to go about a man's work",
    paraphrase: "When reluctance makes action difficult, recall the kind of work a human being is constituted to perform rather than treating comfort as the governing aim.",
    concepts: ["duty", "human_function", "action", "comfort", "nature"],
    reasoning_edges: [
      { from: "human_nature", relation: "implies", to: "characteristic_work" },
      { from: "comfort", relation: "does_not_override", to: "duty" },
      { from: "reluctance", relation: "can_be_reframed_by", to: "purpose" },
    ],
    default_inference_ceiling: "B",
    temporal_boundary: "ancient_roman_context",
    uncertainty: "Low for duty-over-comfort structure; broader claims about vocation require additional evidence.",
    contradiction_links: [],
    notes: "Good test record for modern productivity questions, which should normally be class D if mapped to contemporary work systems.",
  },
  {
    record_id: "MA-MED-06-54",
    lineage_id: "MA-001",
    work: "Meditations",
    locator: "6.54",
    source_tier: "T1_PRIMARY_TRANSLATION",
    translation: "Meric Casaubon",
    source_url: "https://www.gutenberg.org/files/2680/2680-h/2680-h.htm",
    anchor_text: "cannot be good for the bee",
    paraphrase: "A good that harms the larger community cannot straightforwardly count as a good for the individual member of that community.",
    concepts: ["common_good", "individual_good", "community", "interdependence"],
    reasoning_edges: [
      { from: "individual_good", relation: "is_constrained_by", to: "common_good" },
      { from: "membership_in_whole", relation: "creates", to: "relational_obligations" },
    ],
    default_inference_ceiling: "B",
    temporal_boundary: "ancient_roman_context",
    uncertainty: "Low for the whole-member analogy; modern political applications require contextual qualification.",
    contradiction_links: [],
    notes: "High-value record for council questions involving sovereignty, institutional design, and common welfare.",
  },
  {
    record_id: "MA-MED-08-47",
    lineage_id: "MA-001",
    work: "Meditations",
    locator: "8.47",
    source_tier: "T1_PRIMARY_TRANSLATION",
    translation: "Meric Casaubon",
    source_url: "https://www.gutenberg.org/files/2680/2680-h/2680-h.htm",
    anchor_text: "it is not that properly that doth cause it",
    paraphrase: "Distress from an external event depends partly on the judgment added to the event; the judgment itself is a legitimate target of examination and revision.",
    concepts: ["judgment", "distress", "external_events", "agency", "cognitive_reappraisal"],
    reasoning_edges: [
      { from: "external_event", relation: "is_interpreted_by", to: "judgment" },
      { from: "judgment", relation: "can_contribute_to", to: "distress" },
      { from: "judgment", relation: "is_partly_subject_to", to: "revision" },
    ],
    default_inference_ceiling: "B",
    temporal_boundary: "ancient_roman_context",
    uncertainty: "Low for the judgment-distress relation; do not overextend into claims that all suffering is voluntary or purely cognitive.",
    contradiction_links: [],
    notes: "Important guardrail passage: modern clinical or neurological claims must not be inferred from this text.",
  },
  {
    record_id: "MA-MED-10-16",
    lineage_id: "MA-001",
    work: "Meditations",
    locator: "10.16",
    source_tier: "T1_PRIMARY_TRANSLATION",
    translation: "Meric Casaubon",
    source_url: "https://www.gutenberg.org/files/2680/2680-h/2680-h.htm",
    anchor_text: "really and actually to be such",
    paraphrase: "Moral inquiry should terminate in practice: do not remain indefinitely in discourse about the qualities of a good person when the task is to embody them.",
    concepts: ["practice", "virtue", "embodiment", "anti_performativity", "action"],
    reasoning_edges: [
      { from: "ethical_discourse", relation: "should_lead_to", to: "ethical_practice" },
      { from: "virtue", relation: "is_demonstrated_by", to: "conduct" },
    ],
    default_inference_ceiling: "B",
    temporal_boundary: "ancient_roman_context",
    uncertainty: "Low for practice-over-discourse emphasis.",
    contradiction_links: [],
    notes: "Useful for testing whether the AVOT confuses philosophical fluency with ethical authority.",
  },
  {
    record_id: "MA-MED-12-13",
    lineage_id: "MA-001",
    work: "Meditations",
    locator: "12.13",
    source_tier: "T1_PRIMARY_TRANSLATION",
    translation: "Meric Casaubon",
    source_url: "https://www.gutenberg.org/files/2680/2680-h/2680-h.htm",
    anchor_text: "If it be not true, speak it not",
    paraphrase: "Action should be filtered by fittingness and speech by truth, while preserving freedom of judgment from compulsion.",
    concepts: ["truth", "right_action", "speech", "integrity", "independence_of_judgment"],
    reasoning_edges: [
      { from: "proposed_action", relation: "requires", to: "ethical_filter" },
      { from: "proposed_speech", relation: "requires", to: "truth_filter" },
      { from: "judgment", relation: "should_remain_free_from", to: "compulsion" },
    ],
    default_inference_ceiling: "A",
    temporal_boundary: "ancient_roman_context",
    uncertainty: "Low for the direct maxim; interpretation of 'fitting' requires broader Stoic context.",
    contradiction_links: [],
    notes: "Strong candidate for evaluating truthfulness and action-boundary behavior in MA-001.",
  },
] as const;
