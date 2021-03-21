function parseJWT(token) {
    if (token != null) {
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        var jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    }
};

function getToken() {
    if (document.cookie) {
        return getCookieValue("token");
    } else {
        return 0;
    }
}

function getCookieValue(key) {
    const cookie = document.cookie.match('(^|;)\\s*' + key + '\\s*=\\s*([^;]+)');
    return cookie ? cookie.pop() : '';
}