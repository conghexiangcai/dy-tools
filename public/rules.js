window.filterDefaults={"fans":"10000","fans-min":"","works-limit":"20","works-min":"","logic":"or","mutual":"","decision":"match","works-state":"","opened-state":"","sort":"difference_desc","following-greater":false,"search":"","batch-size":"5"};
window.classifyRow=function classify(row, settings) {
    const values = [];
    for (const [id, key, op, label] of [['fans', 'follower_count', 'lt', '粉丝'], ['fans-min', 'follower_count', 'gt', '粉丝'], ['works-limit', 'works_count', 'lt', '作品'], ['works-min', 'works_count', 'gt', '作品']]) {
        const raw = String(settings[id] ?? '').trim();
        if (!raw)
            continue;
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 0)
            throw Error('阈值请输入非负整数');
        const v = row[key];
        values.push({ label: `${label} ${op === 'gt' ? '>' : '<'} ${n.toLocaleString('zh-CN')}`, value: v === null ? null : op === 'gt' ? v > n : v < n });
    }
    if (settings['following-greater'])
        values.push({ label: '关注 > 粉丝', value: row.following_count === null || row.follower_count === null ? null : row.following_count > row.follower_count });
    const vals = values.map(x => x.value);
    const state = !vals.length ? 'match' : settings.logic === 'and' ? (vals.includes(false) ? 'excluded' : vals.includes(null) ? 'pending' : 'match') : (vals.includes(true) ? 'match' : vals.includes(null) ? 'pending' : 'excluded');
    return { state, matched: values.filter(x => x.value === true).map(x => x.label) };
};
