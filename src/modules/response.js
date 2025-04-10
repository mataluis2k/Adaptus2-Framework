/* define a globale response object to store the response from the rule engine
*/
const response = {
    success: true,
    code: null,
    status: 200,
    message: '',
    error: '',
    data: {},
    module: '',
    setResponse: function(status, message, error, data, module, success=true, code=null){
        console.log('Updating response:', { status, message, error, data, module, success, code});
        this.success = success;
        this.code = code;
        this.status = status;
        if(status === 600){
            this.status = 200;
        }
        this.message = message;
        this.error = error;
        this.data = data;
        this.module = module;
        return this;
    },
    getResponse: function(){
      return this;
    },
    Reset: function(){
        console.log('Resetting response');
        this.status = 200;
        this.message = '';
        this.error = '';
        this.module = '';
        this.code = null;
        this.success = true;
        this.data = {};
        return this;
    },
    unauthorized: function(){
        return { httpCode: 403, message: 'Access Denied', code: null };
    },
}

module.exports = response;
