/**
 * Conservative fallback used only by scripted replay paths. Live messages are
 * classified by the structured AI prompt. False negatives are safer here than
 * cancelling an order from a question or hypothetical.
 */
export function isExplicitOrderCancellation(text: string) {
	const value = text.trim().toLowerCase();
	if (!value || /[?？]/.test(value)) return false;
	if (
		/\b(?:can|could|may|would)\s+(?:i|we)\s+cancel\b|\bwhat\s+(?:happens|if)\b|\bif\s+(?:i|we)\s+cancel\b|\b(?:maybe|considering|thinking (?:about|of))\s+cancell?ing?\b/i.test(
			value,
		) ||
		/\b(?:boleh|jika|kalau|mungkin|macam mana)\b.*\bbatal/i.test(value) ||
		/(?:如果|能否|可以|怎么|如何).*(?:取消|撤销)|(?:取消|撤销).*[吗嘛呢]/.test(
			value,
		)
	)
		return false;

	return [
		/^(?:please\s+)?(?:cancel|terminate)(?:\s+(?:it|everything|my|our|the|this|order|job|quote|quotation|agreement))*[.!]?$/i,
		/\b(?:i|we)\s+(?:(?:have|already)\s+)?(?:decided|want|need|wish|would like)\s+to\s+(?:cancel|terminate)\b/i,
		/\b(?:please\s+)?(?:cancel|terminate)\s+(?:my|our|the|this)\s+(?:order|job|quote|quotation|agreement)\b/i,
		/\bdo not proceed with\s+(?:my|our|the|this)\s+(?:order|job|quote|quotation|agreement)\b/i,
		/^(?:tolong\s+)?batal(?:kan)?(?:\s+(?:pesanan|tempahan|sebut harga|order|kerja)(?:\s+(?:saya|kami|ini))?)?[.!]?$/i,
		/\b(?:saya|kami)\s+(?:(?:sudah|telah)\s+)?(?:(?:buat keputusan|memutuskan)\s+untuk\s+|(?:nak|mahu|hendak)\s+)?batal(?:kan)?\b/i,
		/^(?:请|麻烦)?(?:帮我|帮我们)?(?:取消|撤销)(?:我的|我们的|这个|该)?(?:订单|报价|合约|协议)[。！!]?$/,
		/(?:我|我们)(?:已经)?决定(?:取消|撤销)(?:订单|报价|合约|协议)/,
	].some((pattern) => pattern.test(value));
}
