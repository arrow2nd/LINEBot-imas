'use strict';
const request = require('request');
const moment = require('moment-timezone');
const imageURLCache = require('../cache/ogp_url.json');

/**
 * アイドルのプロフィールを検索する
 *
 * @param  {String} keyword キーワード
 * @return {Object}         メッセージオブジェクト
 */
async function getIdolProfile(keyword) {
    let profile;

    // メッセージをパース
    keyword = parseMessage(keyword);

    // プロフィールを検索
    try {
        profile = await search(keyword);
    } catch (err) {
        return err;
    };

    // flexMessageを作成
    const message = createMessage(profile);

    return message;
};

/**
 * メッセージを解析して検索文字列を作成
 *
 * @param  {String} text メッセージテキスト
 * @return {String}      検索文字列
 */
function parseMessage(text) {
    // 改行と空白を削除
    text = text.trim().replace(/[\n ]/g, '');

    // 誕生日検索かチェック
    if (text.match(/誕生日/)) {
        const mode = (text.match(/明日/)) ? 3 : (text.match(/昨日/)) ? 1 : 2;
        const addDays = mode - 2;
        return moment().add(addDays, 'days').tz('Asia/Tokyo').format('MM-DD');
    };

    // メッセージが日付かチェック
    for (let format of ['M月D日', 'M/D']) {
        let date = moment(text, format, true);
        if (date.isValid()) {
            return date.format('MM-DD');
        };
    };

    return text;
};

/**
 * imasparqlからプロフィールを取得
 *
 * @param  {String} words 検索文字列
 * @return {Object}       成功時: プロフィールデータ
 *                        失敗時: メッセージオブジェクト
 */
function search(words) {
    return new Promise((resolve, reject) => {
        let searchCriteria;

        // MM-DD形式なら誕生日検索、それ以外なら通常検索
        if (words.match(/^\d{1,2}-\d{1,2}/)) {
            searchCriteria = `
            rdf:type ?type;
            schema:birthDate ?BD.
            FILTER(?type IN (imas:Idol,imas:Staff)).
            FILTER(regex(str(?BD),"${words}")).
            OPTIONAL{?data imas:nameKana ?名前ルビ.}
            OPTIONAL{?data imas:alternateNameKana ?名前ルビ.}
            OPTIONAL{?data imas:givenNameKana ?名前ルビ.}
            `;
        } else {
            searchCriteria = `
            rdf:type ?type.
            FILTER(?type IN (imas:Idol,imas:Staff)).
            OPTIONAL{?data schema:name ?本名.}
            OPTIONAL{?data imas:nameKana ?名前ルビ.}
            OPTIONAL{?data imas:alternateNameKana ?名前ルビ.}
            OPTIONAL{?data imas:givenNameKana ?名前ルビ.}
            FILTER(CONTAINS(?名前,"${words}")||CONTAINS(?本名,"${words}")||CONTAINS(?名前ルビ,"${words}")).
            `;
        };

        // プロフィールを引っ張ってくるクエリ(ながい)
        const query = `
        PREFIX schema: <http://schema.org/>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX imas: <https://sparql.crssnky.xyz/imasrdf/URIs/imas-schema.ttl#>
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>
        SELECT DISTINCT ?名前 ?名前ルビ ?所属 ?性別 ?年齢 ?身長 ?体重 ?BWH ?誕生日 ?星座 ?血液型 ?利き手 ?出身地 (GROUP_CONCAT(DISTINCT ?hobby;separator=',') as ?趣味) (GROUP_CONCAT(DISTINCT ?favorite;separator=',') as ?好きなもの) ?説明 ?カラー ?CV ?URL
        WHERE {
            ?data rdfs:label ?名前;
            ${searchCriteria}
            OPTIONAL {?data imas:Title ?所属.}
            OPTIONAL {?data schema:gender ?性別.}
            OPTIONAL {?data foaf:age ?年齢.}
            OPTIONAL {?data schema:height ?身長.}
            OPTIONAL {?data schema:weight ?体重.}
            OPTIONAL {
                ?data imas:Bust ?B;
                imas:Waist ?W;
                imas:Hip ?H.
                BIND(CONCAT(str(?B), "/", str(?W), "/", str(?H)) as ?BWH)
            }
            OPTIONAL {?data schema:birthDate ?誕生日.}
            OPTIONAL {?data imas:Constellation ?星座.}
            OPTIONAL {?data imas:BloodType ?血液型.}
            OPTIONAL {?data imas:Handedness ?利き手.}
            OPTIONAL {?data schema:birthPlace ?出身地.}
            OPTIONAL {?data imas:Hobby ?hobby.}
            OPTIONAL {?data imas:Favorite ?favorite.}
            OPTIONAL {?data schema:description ?説明.}
            OPTIONAL {
                ?data imas:Color ?color.
                BIND(CONCAT("#", str(?color)) as ?カラー)
            }
            OPTIONAL {
                ?data imas:cv ?CV.
                FILTER(lang(?CV)='ja').
            }
            OPTIONAL {?data imas:IdolListURL ?URL}
        } GROUP BY ?名前 ?名前ルビ ?所属 ?性別 ?年齢 ?身長 ?体重 ?BWH ?誕生日 ?星座 ?血液型 ?利き手 ?出身地 ?説明 ?カラー ?CV ?URL
        LIMIT 5
        `;

        const url = `https://sparql.crssnky.xyz/spql/imas/query?output=json&query=${encodeURIComponent(query)}`;

        request.get(url, (err, res, body) => {
            if (!err && res.statusCode === 200) {
                const data = JSON.parse(body).results.bindings;
                resolve(data);
            } else {
                console.log('Error: im@sparqlにアクセスできません');
                console.error(err);
                reject(errorMessage('検索できませんでした', 'im@sparqlにアクセスできません'));
            };
        });
    });
};

/**
 * メッセージオブジェクトを作成
 *
 * @param  {Object} data 取得したプロフィールデータ
 * @return {Object}      メッセージオブジェクト
 */
function createMessage(profileData) {
    let carousel = [];

    // データが無い場合はエラー
    if (!profileData.length) {
        console.log('NotFound');
        return errorMessage('みつかりませんでした…', 'ごめんなさい！');
    };

    for (let data of profileData) {
        let profile = [];

        // 表現を調整
        data = convertExpression(data);

        // プロフィール内容作成
        for (let key in data) {
            if (['名前', '名前ルビ', '所属', 'URL'].includes(key)) {
                continue;
            };
            profile.push(createProfileLine(key, data[key].value));
        };

        // アイドルの画像
        const imageURL = getImageURL(data.名前.value);

        // カルーセルに追加
        carousel.push(createBubble(data, profile, imageURL));
    };

    const result = {
        'type': 'flex',
        'altText': `${profileData.length}人みつかりました！`,
        'contents': {
            'type': 'carousel',
            'contents': carousel
        }
    };

    return result;
};

/**
 * 表現を変換
 *
 * @param  {Object} data プロフィールデータ
 * @return {Object}      変換後のプロフィールデータ
 */
function convertExpression(data) {
    const convert = {
        series: {
            CinderellaGirls: '346Pro (CinderellaGirls)',
            '1st Vision': '765Pro (旧プロフィール)',
            DearlyStars: '876Pro (DearlyStars)',
            '315ProIdols': '315Pro (SideM)',
            MillionStars: '765Pro (MillionLive!)',
            '283Pro': '283Pro (ShinyColors)',
            '765AS': '765Pro (IDOLM@STER)',
            '961ProIdols': '961Pro (IDOLM@STER)',
            '1054Pro': '1054Pro (IDOLM@STER)'
        },
        gender: {
            male: '男性',
            female: '女性'
        },
        handedness: {
            right: '右利き',
            left: '左利き',
            both: '両利き'
        },
        addUnit: [
            {
                key: '年齢',
                unit: '歳'
            },
            {
                key: '身長',
                unit: 'cm'
            },
            {
                key: '体重',
                unit: 'kg'
            },
            {
                key: '血液型',
                unit: '型'
            }
        ]
    };

    // シリーズ名
    if (data.所属) {
        const title = convert.series[data.所属.value];
        data.所属.value = (title) ? title : data.所属.value;
    };

    // 性別
    if (data.性別) {
        const jp = convert.gender[data.性別.value];
        data.性別.value = (jp) ? jp : '不明';
    };

    // 利き手
    if (data.利き手) {
        const jp = convert.handedness[data.利き手.value];
        data.利き手.value = (jp) ? jp : '不明';
    };

    // 誕生日のフォーマット
    if (data.誕生日) {
        data.誕生日.value = moment(data.誕生日.value, '-MM-DD').format('M月D日');
    };

    // 単位を追加
    const regex = /[a-zA-Z0-9?]/;
    for (let i = 0; i < convert.addUnit.length; i++) {
        const chkKey = convert.addUnit[i].key;
        if (data[chkKey] && regex.test(data[chkKey].value)) {
            data[chkKey].value += convert.addUnit[i].unit;
        };
    };

    return data;
};

/**
 * 画像のURLをキャッシュから取得
 *
 * @param  {String} name アイドル名
 * @return {String}      URL
 */
function getImageURL(name) {
    const noImage = 'https://arrow2nd.github.io/images/img/noimage.png';
    const imageURL = imageURLCache[name];

    // URLが無い場合NOIMAGEを返す
    if (!imageURL) {
        return noImage;
    };

    return imageURL;
};

/**
 * プロフィール（行）を作成
 *
 * @param  {String} key   項目名
 * @param  {String} value 内容
 * @return {Object}       1行分のテキストコンポーネント
 */
function createProfileLine(key, value) {
    const contents = {
        'type': 'box',
        'layout': 'baseline',
        'contents': [
            {
                'type': 'text',
                'text': key,
                'size': 'sm',
                'color': '#949494',
                'flex': 2
            },
            {
                'type': 'text',
                'text': value,
                'wrap': true,
                'size': 'sm',
                'flex': 4,
                'color': '#666666'
            }
        ],
        'spacing': 'sm'
    };

    return contents;
};

/**
 * フッターを作成
 *
 * @param  {Object} data プロフィールデータ
 * @return {Array}       フッターのコンポーネント
 */
function createFooter(data) {
    const colorCode = (data.カラー) ? data.カラー.value : '#ff73cc';
    let footer = [];

    // アイドル名鑑
    if (data.URL) {
        footer.push({
            'type': 'button',
            'height': 'sm',
            'style': 'link',
            'offsetTop': '-10px',
            'action': {
                'type': 'uri',
                'label': 'アイドル名鑑を開く！',
                'uri': data.URL.value
            }
        });
    };

    // Googleで検索！
    footer.push({
        'type': 'button',
        'height': 'sm',
        'style': 'primary',
        'color': colorCode,
        'offsetTop': '-5px',
        'action': {
            'type': 'uri',
            'label': 'Googleで検索！',
            'uri': `http://www.google.co.jp/search?hl=ja&source=hp&q=${encodeURIComponent(`アイドルマスター ${data.名前.value}`)}`
        }
    });

    return footer;
};

/**
 * バブルを作成
 *
 * @param  {Object} data    取得したプロフィールデータ
 * @param  {Array}  profile プロフィールのコンポーネント
 * @param  {String} imgUrl  画像URL
 * @return {Object}         バブル
 */
function createBubble(data, profile, imgUrl) {
    const name = data.名前.value;
    const subText = (data.所属) ? data.名前ルビ.value + `・${data.所属.value}` : data.名前ルビ.value;
    const footer = createFooter(data);
    const bubble = {
        'type': 'bubble',
        'size': 'mega',
        'body': {
            'type': 'box',
            'layout': 'vertical',
            'contents': [
                {
                    'type': 'image',
                    'url': imgUrl,
                    'size': 'full',
                    'aspectMode': 'cover',
                    'aspectRatio': '16:9',
                    'gravity': 'center'
                },
                {
                    'type': 'image',
                    'url': 'https://arrow2nd.github.io/images/img/gradation.png',
                    'size': 'full',
                    'aspectMode': 'cover',
                    'aspectRatio': '16:9',
                    'position': 'absolute'
                },
                {
                    'type': 'box',
                    'layout': 'vertical',
                    'contents': [
                        {
                            'type': 'text',
                            'text': name,
                            'size': 'xl',
                            'color': '#ffffff',
                            'weight': 'bold'
                        },
                        {
                            'type': 'text',
                            'text': subText,
                            'size': 'xs',
                            'color': '#ffffff'
                        }
                    ],
                    'position': 'absolute',
                    'offsetTop': '110px',
                    'paddingStart': '15px'
                },
                {
                    'type': 'box',
                    'layout': 'vertical',
                    'contents': profile,
                    'paddingStart': '15px',
                    'paddingTop': '15px',
                    'paddingBottom': '10px',
                    'paddingEnd': '15px'
                }
            ],
            'paddingAll': '0px'
        },
        'footer': {
            'type': 'box',
            'layout': 'vertical',
            'contents': footer
        }
    };

    return bubble;
};

/**
 * エラーメッセージ
 *
 * @param  {String} title タイトル
 * @param  {String} msg   エラー内容
 * @return {Object}       メッセージオブジェクト
 */
function errorMessage(title, msg) {
    const errMsg = {
        'type': 'flex',
        'altText': title,
        'contents': {
            'type': 'bubble',
            'body': {
                'type': 'box',
                'layout': 'vertical',
                'contents': [
                    {
                        'type': 'text',
                        'weight': 'bold',
                        'size': 'md',
                        'text': title
                    },
                    {
                        'type': 'text',
                        'text': msg,
                        'size': 'xs',
                        'color': '#949494',
                        'margin': 'sm'
                    }
                ]
            }
        }
    };

    return errMsg;
};

module.exports = {
    getIdolProfile
};
